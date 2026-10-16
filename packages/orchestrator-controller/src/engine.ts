/**
 * The orchestration engine: plan → schedule → delegate → validate → propose.
 * Every external capability arrives through the injected {@link EngineDeps}
 * seam so the run loop is testable without a live Host.
 * @module dsh-orchestrator-controller/engine
 */

import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { DriverResult, OrchestratorDriver } from './driver.ts'
import {
  attachValidator,
  buildGraph,
  cascadeSkipped,
  failedNodes,
  isSettled,
  readyNodes,
  PLAN_OUTPUT_SCHEMA,
  type GraphNode,
} from './graph.ts'
import { applyDiff, collectDiff, createWorktree, git, removeWorktree } from './git.ts'
import {
  coercePlan,
  nodePrompt,
  plannerPrompt,
  validatorPrompt,
  VALIDATION_OUTPUT_SCHEMA,
  type PlannerCatalogEntry,
} from './prompts.ts'
import type { OrchestratorRunRecord } from './domain.ts'
import type {
  OrchestratorModelRoute,
  OrchestratorNodeView,
  OrchestratorSubmitInput,
} from './types.ts'

/** Minimal agent-factory surface the engine requires from `ctx.agents`. */
export interface EngineAgentFactory {
  create(options: {
    sessionId: SessionId
    parentAgent?: Agent
    meta: { cwd: string }
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: string }
    signal?: AbortSignal
  }): Promise<AgentHandle>
}

/** Everything the engine borrows from the Host or substitutes in tests. */
export interface EngineDeps {
  /** Provider-agnostic delegation driver. */
  readonly driver: OrchestratorDriver
  /** Creates the run's root orchestrator agent (the subagent parent anchor). */
  readonly agents: EngineAgentFactory
  /** Host subprocess service for git plumbing. */
  readonly subprocess: SubprocessRuntime
  /** Durable record write — called after every transition. */
  readonly persist: (record: OrchestratorRunRecord) => Promise<void>
  /** Directory run worktrees are created under. */
  readonly worktreeRoot: string
  /** Max nodes executing concurrently per run. */
  readonly maxConcurrency: number
  /** Max plan tasks accepted from the planner. */
  readonly maxNodes: number
  /** Max attempts per node, including the first. */
  readonly maxAttempts: number
  /** Per-attempt timeout in milliseconds. */
  readonly nodeTimeoutMs: number
  /** Tool names denied to every delegated node. */
  readonly toolDeny: readonly string[]
  /** Effective routes per role after Config and submit-input resolution. */
  readonly routes: {
    readonly planner: OrchestratorModelRoute
    readonly worker: OrchestratorModelRoute
    readonly validator: OrchestratorModelRoute
  }
  /** Model catalog snapshot for the planner prompt and route validation. */
  readonly catalog: () => Promise<readonly PlannerCatalogEntry[]>
}

/** Internal mutable run record type the engine advances. */
type MutableRecord = {
  -readonly [K in keyof OrchestratorRunRecord]: OrchestratorRunRecord[K]
}

/** Per-run live state; never persisted (the durable copy is the record). */
interface LiveRun {
  record: MutableRecord
  abort: AbortController
  rootHandle: AgentHandle | null
  active: Map<string, { dispose(): Promise<void> }>
  done: Promise<void>
  /** Role routes after merging the submit's `routes` overrides over Config. */
  routes: {
    readonly planner: OrchestratorModelRoute
    readonly worker: OrchestratorModelRoute
    readonly validator: OrchestratorModelRoute
  }
}

/** The validator node id; plan ids come from the model, this one is engine-owned. */
const VALIDATOR_ID = '__validate__'

/** One delegation dispatch, node-shaped or planner-shaped. */
interface DispatchSpec {
  readonly label: string
  readonly prompt: string
  readonly route: OrchestratorModelRoute
  readonly outputSchema?: ObjectJsonSchema
}

/**
 * Runs orchestration over submitted tasks. The engine owns no plugin
 * lifecycle — callers persist and dispose it with the owning service.
 */
export class OrchestratorEngine {
  private readonly live = new Map<string, LiveRun>()

  constructor(private readonly deps: EngineDeps) {}

  /**
   * Create the durable record and launch the run in the background.
   * @returns the freshly persisted run record (status `planning`).
   */
  async submit(input: OrchestratorSubmitInput, parentAgent?: Agent): Promise<OrchestratorRunRecord> {
    if (!isAbsolute(input.cwd)) {
      throw new Error('submit requires an absolute cwd')
    }
    const id = `run-${randomUUID()}`
    const record: MutableRecord = {
      id,
      task: input.task,
      cwd: input.cwd,
      status: 'planning',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      worktree: null,
      nodes: [],
      proposal: null,
      validation: null,
      error: null,
      rootSessionId: `orch-${id}`,
      mode: input.mode ?? 'auto',
    }
    const live: LiveRun = {
      record,
      abort: new AbortController(),
      rootHandle: null,
      active: new Map(),
      done: Promise.resolve(),
      routes: {
        planner: { ...this.deps.routes.planner, ...input.routes?.planner },
        worker: { ...this.deps.routes.worker, ...input.routes?.worker },
        validator: { ...this.deps.routes.validator, ...input.routes?.validator },
      },
    }
    this.live.set(id, live)
    await this.deps.persist(record)
    live.done = this.execute(live, input, parentAgent).catch((error: unknown) => {
      record.status = live.abort.signal.aborted ? 'cancelled' : 'failed'
      record.error = error instanceof Error ? error.message : String(error)
    }).finally(async () => {
      await live.rootHandle?.dispose()
      record.updatedAt = Date.now()
      await this.deps.persist(record)
      this.live.delete(id)
    })
    return record
  }

  /** Abort in-flight work and settle the run as `cancelled`. */
  async cancel(runId: string): Promise<void> {
    const live = this.live.get(runId)
    if (live === undefined) return
    live.abort.abort()
    for (const run of live.active.values()) {
      await run.dispose()
    }
    await live.done
  }

  /**
   * Apply the reviewed proposal into the target repository. The hash binds the
   * approval to the exact diff the user saw; a stale worktree or a moved HEAD
   * rejects before anything is written.
   * @param runId - the run in `awaiting-approval`.
   * @param hash - the sha256 the UI displayed at review time.
   * @param record - the current durable record (fetched by the caller).
   */
  async apply(runId: string, hash: string, record: OrchestratorRunRecord): Promise<void> {
    if (record.status !== 'awaiting-approval' || record.proposal === null) {
      throw new Error(`run ${runId} has no pending proposal`)
    }
    if (record.proposal.hash !== hash) {
      throw new Error('proposal hash mismatch — the reviewed diff is not the pending one')
    }
    if (record.worktree === null) {
      throw new Error('run worktree is gone; the proposal cannot be revalidated')
    }
    const head = (await git(this.deps.subprocess, record.cwd, ['rev-parse', 'HEAD'])).trim()
    if (head !== record.proposal.baseRev) {
      throw new Error(`target HEAD moved (${head} != ${record.proposal.baseRev}); re-run or rebase the proposal`)
    }
    const fresh = await collectDiff(this.deps.subprocess, record.worktree)
    if (fresh === null || fresh.hash !== hash) {
      throw new Error('worktree contents changed since review; rejecting apply')
    }
    // Re-check immediately before writing; the residual window is one git
    // call, not the full collect pass above.
    const headNow = (await git(this.deps.subprocess, record.cwd, ['rev-parse', 'HEAD'])).trim()
    if (headNow !== record.proposal.baseRev) {
      throw new Error(`target HEAD moved (${headNow} != ${record.proposal.baseRev}); re-run or rebase the proposal`)
    }
    await applyDiff(this.deps.subprocess, record.cwd, fresh.diff)
  }

  /**
   * Remove the run's worktree. Only valid once the run is terminal. The
   * directory is left in place when git refuses — nothing is force-deleted.
   */
  async discard(runId: string, record: OrchestratorRunRecord): Promise<void> {
    if (record.status === 'planning' || record.status === 'running') {
      throw new Error(`run ${runId} is still active; cancel it first`)
    }
    if (record.worktree !== null) {
      await removeWorktree(this.deps.subprocess, record.cwd, record.worktree)
    }
  }

  /** The live controller of a running run, for cancel wiring and tests. */
  liveRun(runId: string): { abort: AbortController; done: Promise<void> } | undefined {
    return this.live.get(runId)
  }

  /** The full run lifecycle after the record exists. */
  private async execute(live: LiveRun, input: OrchestratorSubmitInput, parentAgent?: Agent): Promise<void> {
    const { record } = live
    const signal = live.abort.signal

    // Isolated worktree + root orchestrator agent anchored to it. Every
    // spawned child inherits the worktree cwd, so model writes never touch the
    // user's working tree.
    await mkdir(this.deps.worktreeRoot, { recursive: true })
    const worktreePath = join(this.deps.worktreeRoot, record.id)
    const baseRev = await createWorktree(this.deps.subprocess, record.cwd, worktreePath, signal)
    record.worktree = worktreePath
    const rootHandle = await this.deps.agents.create({
      sessionId: brandString<SessionId>(record.rootSessionId),
      ...(parentAgent !== undefined ? { parentAgent } : {}),
      meta: { cwd: worktreePath },
      agentOptions: this.routeOptions(live.routes.planner),
      signal,
    })
    live.rootHandle = rootHandle
    const parent: Agent = rootHandle.agent
    record.updatedAt = Date.now()
    await this.deps.persist(record)

    // Planner delegation — one structured-output spawn.
    const catalog = await this.deps.catalog()
    const planResult = await this.dispatch(live, {
      label: `${record.id}/plan`,
      prompt: plannerPrompt(record.task, record.mode, catalog, this.deps.maxNodes),
      route: live.routes.planner,
      outputSchema: PLAN_OUTPUT_SCHEMA,
    }, parent)
    if (planResult.structured === undefined) {
      throw new Error(`planner produced no structured plan (stopReason: ${planResult.stopReason})`)
    }
    const nodes = buildGraph(coercePlan(planResult.structured), {
      maxNodes: this.deps.maxNodes,
      workerRoute: live.routes.worker,
      ...(catalog.length > 0
        ? { allowedProviders: new Set(catalog.map(entry => entry.provider)) }
        : {}),
    })
    attachValidator(nodes, live.routes.validator)
    record.nodes = this.project(nodes)
    record.status = 'running'
    record.updatedAt = Date.now()
    await this.deps.persist(record)

    // Schedule the DAG under the concurrency cap.
    const depOutputs = new Map<string, string>()
    const inFlight = new Map<string, Promise<void>>()
    const launch = async (node: GraphNode): Promise<void> => {
      node.status = 'running'
      let prompt = nodePrompt(node, record.task, depOutputs)
      if (node.role === 'validator') {
        // The validator reviews the real diff, not a placeholder.
        const staged = await collectDiff(this.deps.subprocess, worktreePath, signal)
        prompt = validatorPrompt(record.task, [...nodes.values()].filter((n) => n.role !== 'validator'), staged?.stat ?? '')
      }
      const task = this.dispatch(live, {
        label: `${record.id}/${node.id}`,
        prompt,
        route: node.route,
        ...(node.role === 'validator' ? { outputSchema: VALIDATION_OUTPUT_SCHEMA } : {}),
      }, parent, node).then(async (result) => {
        inFlight.delete(node.id)
        if (result.stopReason === 'completed') {
          node.output = result.output
          node.error = null
          if (node.role === 'validator') {
            const verdict = result.structured as { verdict?: string; summary?: string; issues?: string[] } | undefined
            // Fail closed: no structured verdict never reads as a pass.
            record.validation = verdict === undefined
              ? { verdict: 'fail', summary: 'validator returned no structured verdict', issues: [] }
              : {
                verdict: verdict.verdict === 'fail' ? 'fail' : 'pass',
                summary: String(verdict.summary ?? ''),
                issues: Array.isArray(verdict.issues) ? verdict.issues.map(String) : [],
              }
            node.output = record.validation.summary
          }
          depOutputs.set(node.id, node.output)
          node.status = 'done'
        } else {
          const detail = result.diagnostic ?? result.stopReason
          if (result.retryable && node.attempts < this.deps.maxAttempts && !signal.aborted) {
            node.status = 'pending'
            node.error = detail
          } else {
            node.status = 'failed'
            node.error = detail
          }
        }
        await this.deps.persist(this.snapshot(record, nodes))
      }, async (error: unknown) => {
        // A rejecting dispatch (provider abort, spawn failure) settles the node
        // as failed so the scheduler stays consistent — rejections are not
        // retried; only structured retryable results consume another attempt.
        inFlight.delete(node.id)
        node.status = 'failed'
        node.error = error instanceof Error ? error.message : String(error)
        await this.deps.persist(this.snapshot(record, nodes))
      })
      inFlight.set(node.id, task)
    }

    while (!isSettled(nodes)) {
      if (signal.aborted) break
      cascadeSkipped(nodes)
      const slots = this.deps.maxConcurrency - inFlight.size
      for (const node of readyNodes(nodes).slice(0, Math.max(0, slots))) {
        await launch(node)
      }
      if (inFlight.size === 0) {
        cascadeSkipped(nodes)
        if (isSettled(nodes)) break
        for (const node of nodes.values()) {
          if (node.status === 'pending') node.status = 'skipped'
        }
        break
      }
      await Promise.race(inFlight.values())
    }
    await Promise.allSettled(inFlight.values())
    // Persist once more so terminal node states (skipped cascades included)
    // survive in the record — per-completion persists only ran per node.
    await this.deps.persist(this.snapshot(record, nodes))

    const failed = failedNodes(nodes)
    if (signal.aborted) {
      record.status = 'cancelled'
      record.error = 'cancelled by user'
      return
    }
    if (failed.length > 0) {
      record.status = 'failed'
      record.error = `failed nodes: ${failed.map((n) => `${n.id} (${n.error ?? 'unknown'})`).join(', ')}`
      return
    }
    if (record.validation === null) {
      record.status = 'failed'
      record.error = 'validator produced no verdict'
      return
    }
    if (record.validation.verdict !== 'pass') {
      record.status = 'failed'
      record.error = `validation failed: ${record.validation.summary}`
      return
    }

    const proposal = await collectDiff(this.deps.subprocess, worktreePath, signal)
    if (proposal === null) {
      record.status = 'done'
      return
    }
    record.proposal = { hash: proposal.hash, baseRev, stat: proposal.stat, diff: proposal.diff }
    record.status = 'awaiting-approval'
  }

  /**
   * One delegation attempt through the driver. The attempt timeout composes
   * with the run abort; the delegated run is always disposed.
   */
  private async dispatch(
    live: LiveRun,
    spec: DispatchSpec,
    parent: Agent,
    node?: GraphNode,
  ): Promise<DriverResult> {
    node && (node.attempts += 1)
    const attemptSignal = AbortSignal.any([live.abort.signal, AbortSignal.timeout(this.deps.nodeTimeoutMs)])
    const run = await this.deps.driver.start({
      label: spec.label,
      prompt: spec.prompt,
      parent,
      signal: attemptSignal,
      route: spec.route,
      ...(spec.outputSchema !== undefined ? { outputSchema: spec.outputSchema } : {}),
      toolFilter: { deny: [...this.deps.toolDeny] },
    })
    const key = node?.id ?? spec.label
    live.active.set(key, run)
    // A start() resolving after cancel()'s sweep would otherwise run detached.
    if (live.abort.signal.aborted) {
      live.active.delete(key)
      await run.dispose()
      return { output: '', stopReason: 'aborted', retryable: false }
    }
    try {
      return await run.result
    } finally {
      live.active.delete(key)
      await run.dispose()
    }
  }

  /** Map a route into the factory's `agentOptions` vocabulary. */
  private routeOptions(route: OrchestratorModelRoute): { provider?: string; model?: string; reasoningEffort?: string } {
    const options: { provider?: string; model?: string; reasoningEffort?: string } = {}
    if (route.provider !== undefined) options.provider = route.provider
    if (route.model !== undefined) options.model = route.model
    if (route.reasoningEffort !== undefined) options.reasoningEffort = route.reasoningEffort
    return options
  }

  /** Project the runtime graph into the stored wire view. */
  private project(nodes: Map<string, GraphNode>): OrchestratorNodeView[] {
    return [...nodes.values()].map((node) => ({
      id: node.id,
      title: node.title,
      parentId: node.parentId,
      deps: node.deps,
      role: node.role,
      route: node.route,
      status: node.status,
      attempts: node.attempts,
      output: node.output,
      error: node.error,
    }))
  }

  /** Persist with a refreshed node projection and timestamp. */
  private snapshot(record: MutableRecord, nodes: Map<string, GraphNode>): OrchestratorRunRecord {
    record.updatedAt = Date.now()
    record.nodes = this.project(nodes)
    return record
  }
}
