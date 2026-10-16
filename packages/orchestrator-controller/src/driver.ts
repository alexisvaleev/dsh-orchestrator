/**
 * The provider adapter boundary. The engine talks to {@link OrchestratorDriver}
 * only; {@link SubagentDriver} adapts the native `ctx.subagents` seam, and
 * tests substitute a scripted driver. No provider-specific logic may appear
 * outside this module.
 * @module dsh-orchestrator-controller/driver
 */

import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema, ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { OrchestratorModelRoute } from './types.ts'

/** One delegated node execution request, provider-neutral. */
export interface DriverRequest {
  /** Display label of the delegated run. */
  readonly label: string
  /** Self-contained instruction text for the child. */
  readonly prompt: string
  /** The live parent agent the run is attributed to. */
  readonly parent: Agent
  /** Cancellation covering both dispatch and in-flight work. */
  readonly signal: AbortSignal
  /** Requested model route for the child. */
  readonly route: OrchestratorModelRoute
  /** Structured-output schema, when the node requires one. */
  readonly outputSchema?: ObjectJsonSchema
  /** Per-child tool restriction. */
  readonly toolFilter?: ToolRestriction
  /** Persona id to scope into the child's prompt. */
  readonly persona?: string
}

/** Terminal facts of one delegated run. */
export interface DriverResult {
  /** Concatenated assistant text of the child's final message. */
  readonly output: string
  /** Structured output when a schema was requested and satisfied. */
  readonly structured?: unknown
  /** Provider stop reason; `completed` is the only success. */
  readonly stopReason: string
  /** Provider-authored failure detail, sanitized upstream. */
  readonly diagnostic?: string
  /** Whether a transient failure merits another attempt. */
  readonly retryable: boolean
}

/** A dispatched, possibly still-running delegation. */
export interface DriverRun {
  readonly result: Promise<DriverResult>
  /** Cancel remaining work and release resources; idempotent. */
  dispose(): Promise<void>
}

/** The engine's seam into subagent providers. */
export interface OrchestratorDriver {
  start(request: DriverRequest): Promise<DriverRun>
}

/** `stopReason` values worth a retry under the configured attempt limit. */
const RETRYABLE_STOP_REASONS = new Set(['error', 'max-tokens'])

/** Flatten content blocks into display text for node outputs. */
export function contentText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('')
}

/**
 * Driver over the native `ctx.subagents` seam. One provider name covers every
 * node; per-node model routes ride `agentOptions`, which in-process providers
 * merge over the parent's current route.
 */
export class SubagentDriver implements OrchestratorDriver {
  /**
   * @param subagents - the Host's subagent runtime.
   * @param providerName - registered provider name (`spawn` ships with the base bundle).
   * @param maxDepth - delegation depth forwarded to every node.
   */
  constructor(
    private readonly subagents: SubagentRuntime,
    private readonly providerName: string,
    private readonly maxDepth: number | undefined,
  ) {}

  async start(request: DriverRequest): Promise<DriverRun> {
    const agentOptions: AgentOptions = {}
    if (request.route.provider !== undefined) agentOptions.provider = request.route.provider
    if (request.route.model !== undefined) agentOptions.model = request.route.model
    if (request.route.reasoningEffort !== undefined) {
      agentOptions.reasoningEffort = request.route.reasoningEffort as ReasoningEffortId
    }
    const run = await this.subagents.start(this.providerName, {
      label: request.label,
      prompt: [{ type: 'text', text: request.prompt }],
      parent: request.parent,
      signal: request.signal,
      agentOptions,
      ...(request.outputSchema !== undefined ? { outputSchema: request.outputSchema } : {}),
      ...(request.toolFilter !== undefined ? { toolFilter: request.toolFilter } : {}),
      ...(request.persona !== undefined ? { persona: request.persona } : {}),
      ...(this.maxDepth !== undefined ? { maxDepth: this.maxDepth } : {}),
    })
    return {
      result: run.result.then((result) => ({
        output: contentText(result.output),
        ...(result.structured !== undefined ? { structured: result.structured } : {}),
        stopReason: result.stopReason,
        ...(result.diagnostic !== undefined ? { diagnostic: result.diagnostic } : {}),
        retryable: RETRYABLE_STOP_REASONS.has(result.stopReason),
      })),
      dispose: () => run.dispose(),
    }
  }
}
