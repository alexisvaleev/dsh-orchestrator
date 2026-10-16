/**
 * Host owner of the `orchestrator` Remote namespace: accepts one complex
 * development task, plans it into isolated subagent delegations, validates the
 * combined result, and prepares a worktree diff that applies only through an
 * exact-hash approval. All writes happen inside a per-run git worktree; the
 * user's workspace is untouched until {@link apply} revalidates the reviewed
 * diff.
 * @module dsh-orchestrator-controller
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { OrchestratorEngine } from './engine.ts'
import { SubagentDriver } from './driver.ts'
import type { OrchestratorRunRecord } from './domain.ts'
import { ORCHESTRATOR_DOMAIN } from './domain.ts'
import type { PlannerCatalogEntry } from './prompts.ts'
import type {
  OrchestratorModelRoute,
  OrchestratorRunView,
  OrchestratorRouteCatalog,
  OrchestratorSubmitInput,
} from './types.ts'

export type * from './types.ts'
export { ORCHESTRATOR_DOMAIN } from './domain.ts'
export type { OrchestratorRunRecord } from './domain.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `orchestrator` Remote namespace. */
    orchestratorController: OrchestratorController
  }
}

/** Plugin deployment configuration. */
export interface Config {
  /** Registered subagent provider used for every delegation (default `spawn`). */
  readonly subagentProvider?: string
  /**
   * Llm provider routes exposed to the planner and the route picker, e.g.
   * `["devin", "deepseek-official"]`. Empty means "inherit the session route"
   * — the plan may still name per-task routes only from this catalog.
   */
  readonly routeProviders?: string[]
  /** Default route for the planner delegation. */
  readonly plannerRoute?: OrchestratorModelRoute
  /** Default route for worker nodes without a plan-level override. */
  readonly workerRoute?: OrchestratorModelRoute
  /** Default route for the validator delegation. */
  readonly validatorRoute?: OrchestratorModelRoute
  /** Max nodes executing concurrently inside one run (default 3, max 8). */
  readonly maxConcurrency?: number
  /** Max tasks accepted from one plan (default 8, max 16). */
  readonly maxNodes?: number
  /** Attempts per node including the first (default 2, max 4). */
  readonly maxAttempts?: number
  /** Per-attempt timeout in milliseconds (default 900_000). */
  readonly nodeTimeoutMs?: number
  /** How deep delegated children may themselves delegate (default 0). */
  readonly maxDepth?: number
  /** Directory run worktrees are created under (default `$DSH_HOME/orchestrator` or `~/.dsh/orchestrator`). */
  readonly worktreeRoot?: string
  /** Tool names denied to every delegated node (default `["orchestrate"]`). */
  readonly toolDeny?: string[]
}

const routeSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

/** Default worktree root when the deployment does not configure one. */
function defaultWorktreeRoot(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'orchestrator')
}

/** Host service backing the generated `ctx.remote.orchestrator` namespace. */
export class OrchestratorController extends TypertRemoteService {
  static inject = ['typert', 'subagents', 'agents', 'storageDomain', 'subprocess', 'llm', 'tools']

  static Config: z<Config> = z.object({
    subagentProvider: z.string().default('spawn'),
    routeProviders: z.array(z.string()).default([]),
    plannerRoute: routeSchema,
    workerRoute: routeSchema,
    validatorRoute: routeSchema,
    maxConcurrency: z.number().min(1).max(8).default(3),
    maxNodes: z.number().min(1).max(16).default(8),
    maxAttempts: z.number().min(1).max(4).default(2),
    nodeTimeoutMs: z.number().min(10_000).default(900_000),
    maxDepth: z.number().min(0).max(4).default(0),
    worktreeRoot: z.string(),
    toolDeny: z.array(z.string()).default(['orchestrate']),
  })

  /** Resolved once the domain is open, stale runs are marked, and the engine is live. */
  private readonly ready: Promise<void>
  private engine!: OrchestratorEngine
  private domain: import('@deepseek-ai/dsh-storage-domain').Domain<typeof ORCHESTRATOR_DOMAIN> | undefined

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'orchestratorController', { namespace: 'orchestrator' })
    this.ready = this.init(ctx)
  }

  private async init(ctx: Context): Promise<void> {
    const domain = await ctx.storageDomain.open(ORCHESTRATOR_DOMAIN)
    this.domain = domain
    ctx.effect(() => () => domain.close())

    const table = domain.table('runs')
    for (const [id, record] of table.entries()) {
      if (record.status === 'planning' || record.status === 'running') {
        await table.put(id, { ...record, status: 'interrupted', error: 'host restarted mid-run', updatedAt: Date.now() })
      }
    }

    const persist = async (record: OrchestratorRunRecord): Promise<void> => {
      await table.put(record.id, record)
    }
    const config = this.config
    const driver = new SubagentDriver(ctx.subagents, config.subagentProvider ?? 'spawn', config.maxDepth)
    const deps = {
      driver,
      agents: {
        create: (options: {
          sessionId: SessionId
          meta: { cwd: string }
          agentOptions?: { provider?: string; model?: string; reasoningEffort?: string }
          parentAgent?: Agent
          signal?: AbortSignal
        }): Promise<AgentHandle> => ctx.agents.create({
          sessionId: options.sessionId,
          meta: options.meta,
          ...(options.parentAgent !== undefined ? { parentAgent: options.parentAgent } : {}),
          ...(options.agentOptions !== undefined
            ? { agentOptions: options.agentOptions as import('@deepseek-ai/dsh-agent').AgentOptions }
            : {}),
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        }),
      },
      subprocess: ctx.subprocess,
      persist,
      worktreeRoot: config.worktreeRoot ?? defaultWorktreeRoot(),
      maxConcurrency: config.maxConcurrency ?? 3,
      maxNodes: config.maxNodes ?? 8,
      maxAttempts: config.maxAttempts ?? 2,
      nodeTimeoutMs: config.nodeTimeoutMs ?? 900_000,
      toolDeny: config.toolDeny ?? ['orchestrate'],
      routes: {
        planner: config.plannerRoute ?? {},
        worker: config.workerRoute ?? {},
        validator: config.validatorRoute ?? {},
      },
      catalog: () => this.catalog(),
    }
    this.engine = new OrchestratorEngine(deps)

    const engine = this.engine
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'orchestrate',
      description: 'Decompose a complex development task into isolated sub-agent runs inside a git worktree, execute them in parallel, validate the combined result, and propose a diff that applies only after the user approves it in the Orchestrator panel.',
      parameters: {
        task: { type: 'string', required: true, description: 'The complex development task.' },
        cwd: { type: 'string', description: 'Absolute path of the target git repository. Defaults to the current workspace.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
      },
      async execute(args: { task: string; cwd?: string }, exec: { agent?: Agent }) {
        const cwd = args.cwd ?? exec.agent?.session.header.cwd
        if (cwd === undefined || cwd === null) throw new Error('no cwd given and the calling session has none')
        const record = await engine.submit({ task: args.task, cwd }, exec.agent)
        return `orchestration run ${record.id} started; approve the proposed diff in the Orchestrator panel when it appears`
      },
      presentCall: () => ({ card: 'generic', title: 'Orchestrate task', kind: 'other' }),
    })))
  }

  private async catalog(): Promise<readonly PlannerCatalogEntry[]> {
    const entries: PlannerCatalogEntry[] = []
    for (const provider of this.config.routeProviders ?? []) {
      const models = await this.ctx.llm.listModels(provider)
      entries.push({ provider, models: models.map((m) => m.id) })
    }
    return entries
  }

  /** Submit a new orchestration run. @returns the created run record. */
  @Remote
  async submit(input: OrchestratorSubmitInput): Promise<OrchestratorRunView> {
    await this.ready
    if (typeof input?.task !== 'string' || input.task.trim().length === 0) {
      throw new Error('submit requires a non-empty task')
    }
    if (typeof input.cwd !== 'string' || !input.cwd.startsWith('/')) {
      throw new Error('submit requires an absolute cwd')
    }
    const record = await this.engine.submit(input)
    return this.view(record)
  }

  /** List every run, newest first. */
  @Remote
  async listRuns(): Promise<readonly OrchestratorRunView[]> {
    await this.ready
    const table = this.domain!.table('runs')
    return [...table.entries()]
      .map(([, record]) => record)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((record) => this.view(record))
  }

  /** Fetch one run by id. */
  @Remote
  async getRun(runId: string): Promise<OrchestratorRunView | null> {
    await this.ready
    const record = this.domain!.table('runs').get(runId)
    return record === undefined ? null : this.view(record)
  }

  /** Stream the full run list on every durable change. */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<readonly OrchestratorRunView[]> {
    await this.ready
    const push = async function* (controller: OrchestratorController): AsyncIterable<readonly OrchestratorRunView[]> {
      yield await controller.listRuns()
      const queue: Array<() => void> = []
      const off = controller.ctx.on('domain/changed', (event: { domain?: string }) => {
        if (event.domain === 'orchestrator') {
          const wake = queue.shift()
          wake?.()
        }
      })
      try {
        while (!signal.aborted) {
          await new Promise<void>((resolve) => queue.push(resolve))
          if (signal.aborted) break
          yield await controller.listRuns()
        }
      } finally {
        off()
      }
    }
    yield* push(this)
  }

  /** Cancel a live run. */
  @Remote
  async cancel(runId: string): Promise<void> {
    await this.ready
    const record = this.domain!.table('runs').get(runId)
    if (record === undefined) throw new Error(`unknown run ${runId}`)
    await this.engine.cancel(runId)
  }

  /**
   * Apply the reviewed proposal. `hash` must equal the diff hash shown at
   * review time — the service re-validates the worktree before writing.
   */
  @Remote
  async apply(runId: string, hash: string): Promise<void> {
    await this.ready
    const table = this.domain!.table('runs')
    const record = table.get(runId)
    if (record === undefined) throw new Error(`unknown run ${runId}`)
    await this.engine.apply(runId, hash, record)
    await table.put(runId, { ...record, status: 'applied', updatedAt: Date.now() })
  }

  /** Remove a terminal run's worktree and mark the record discarded. */
  @Remote
  async discard(runId: string): Promise<void> {
    await this.ready
    const table = this.domain!.table('runs')
    const record = table.get(runId)
    if (record === undefined) throw new Error(`unknown run ${runId}`)
    await this.engine.discard(runId, record)
    await table.put(runId, { ...record, worktree: null, updatedAt: Date.now() })
  }

  /** The configured model routes for the UI picker. */
  @Remote
  async listRoutes(): Promise<readonly OrchestratorRouteCatalog[]> {
    await this.ready
    const catalog = await this.catalog()
    return catalog.map((entry) => ({
      provider: entry.provider,
      models: entry.models.map((id) => ({ id, name: null })),
    }))
  }

  /** Project a stored record to the wire view (drops recovery-only fields). */
  private view(record: OrchestratorRunRecord): OrchestratorRunView {
    return {
      id: record.id,
      task: record.task,
      cwd: record.cwd,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      worktree: record.worktree,
      nodes: record.nodes,
      proposal: record.proposal,
      validation: record.validation,
      error: record.error,
    }
  }
}

export default OrchestratorController
