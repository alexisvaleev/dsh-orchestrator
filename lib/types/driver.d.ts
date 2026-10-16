/**
 * The provider adapter boundary. The engine talks to {@link OrchestratorDriver}
 * only; {@link SubagentDriver} adapts the native `ctx.subagents` seam, and
 * tests substitute a scripted driver. No provider-specific logic may appear
 * outside this module.
 * @module dsh-orchestrator/driver
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { ObjectJsonSchema, ToolRestriction } from '@deepseek-ai/dsh-tools';
import type { OrchestratorModelRoute } from './types.ts';
/** One delegated node execution request, provider-neutral. */
export interface DriverRequest {
    /** Display label of the delegated run. */
    readonly label: string;
    /** Self-contained instruction text for the child. */
    readonly prompt: string;
    /** The live parent agent the run is attributed to. */
    readonly parent: Agent;
    /** Cancellation covering both dispatch and in-flight work. */
    readonly signal: AbortSignal;
    /** Requested model route for the child. */
    readonly route: OrchestratorModelRoute;
    /** Structured-output schema, when the node requires one. */
    readonly outputSchema?: ObjectJsonSchema;
    /** Per-child tool restriction. */
    readonly toolFilter?: ToolRestriction;
    /** Persona id to scope into the child's prompt. */
    readonly persona?: string;
}
/** Terminal facts of one delegated run. */
export interface DriverResult {
    /** Concatenated assistant text of the child's final message. */
    readonly output: string;
    /** Structured output when a schema was requested and satisfied. */
    readonly structured?: unknown;
    /** Provider stop reason; `completed` is the only success. */
    readonly stopReason: string;
    /** Provider-authored failure detail, sanitized upstream. */
    readonly diagnostic?: string;
    /** Whether a transient failure merits another attempt. */
    readonly retryable: boolean;
}
/** A dispatched, possibly still-running delegation. */
export interface DriverRun {
    readonly result: Promise<DriverResult>;
    /** Cancel remaining work and release resources; idempotent. */
    dispose(): Promise<void>;
}
/** The engine's seam into subagent providers. */
export interface OrchestratorDriver {
    start(request: DriverRequest): Promise<DriverRun>;
}
/** Flatten content blocks into display text for node outputs. */
export declare function contentText(blocks: readonly ContentBlock[]): string;
/**
 * Driver over the native `ctx.subagents` seam. One provider name covers every
 * node; per-node model routes ride `agentOptions`, which in-process providers
 * merge over the parent's current route.
 */
export declare class SubagentDriver implements OrchestratorDriver {
    private readonly subagents;
    private readonly providerName;
    private readonly maxDepth;
    /**
     * @param subagents - the Host's subagent runtime.
     * @param providerName - registered provider name (`spawn` ships with the base bundle).
     * @param maxDepth - delegation depth forwarded to every node.
     */
    constructor(subagents: SubagentRuntime, providerName: string, maxDepth: number | undefined);
    start(request: DriverRequest): Promise<DriverRun>;
}
//# sourceMappingURL=driver.d.ts.map