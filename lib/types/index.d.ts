/**
 * Host owner of the `orchestrator` Remote namespace: accepts one complex
 * development task, plans it into isolated subagent delegations, validates the
 * combined result, and prepares a worktree diff that applies only through an
 * exact-hash approval. All writes happen inside a per-run git worktree; the
 * user's workspace is untouched until {@link apply} revalidates the reviewed
 * diff.
 * @module dsh-orchestrator
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { OrchestratorModelRoute, OrchestratorRunView, OrchestratorRouteCatalog, OrchestratorSubmitInput } from './types.ts';
export type * from './types.ts';
export { ORCHESTRATOR_DOMAIN } from './domain.ts';
export type { OrchestratorRunRecord } from './domain.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Host owner of the `orchestrator` Remote namespace. */
        orchestratorController: OrchestratorController;
    }
}
/** Plugin deployment configuration. */
export interface Config {
    /** Registered subagent provider used for every delegation (default `spawn`). */
    readonly subagentProvider?: string;
    /**
     * Llm provider routes exposed to the planner and the route picker, e.g.
     * `["devin", "deepseek-official"]`. Empty means "inherit the session route"
     * — the plan may still name per-task routes only from this catalog.
     */
    readonly routeProviders?: string[];
    /** Default route for the planner delegation. */
    readonly plannerRoute?: OrchestratorModelRoute;
    /** Default route for worker nodes without a plan-level override. */
    readonly workerRoute?: OrchestratorModelRoute;
    /** Default route for the validator delegation. */
    readonly validatorRoute?: OrchestratorModelRoute;
    /** Max nodes executing concurrently inside one run (default 3, max 8). */
    readonly maxConcurrency?: number;
    /** Max tasks accepted from one plan (default 8, max 16). */
    readonly maxNodes?: number;
    /** Attempts per node including the first (default 2, max 4). */
    readonly maxAttempts?: number;
    /** Per-attempt timeout in milliseconds (default 900_000). */
    readonly nodeTimeoutMs?: number;
    /** How deep delegated children may themselves delegate (default 0). */
    readonly maxDepth?: number;
    /** Directory run worktrees are created under (default `$DSH_HOME/orchestrator` or `~/.dsh/orchestrator`). */
    readonly worktreeRoot?: string;
    /** Tool names denied to every delegated node (default `["orchestrate"]`). */
    readonly toolDeny?: string[];
}
/** Host service backing the generated `ctx.remote.orchestrator` namespace. */
export declare class OrchestratorController extends TypertRemoteService {
    private readonly config;
    static inject: string[];
    static Config: z<Config>;
    /** Resolved once the domain is open, stale runs are marked, and the engine is live. */
    private readonly ready;
    private engine;
    private domain;
    constructor(ctx: Context, config: Config);
    private init;
    private catalog;
    /** Submit a new orchestration run. @returns the created run record. */
    submit(input: OrchestratorSubmitInput): Promise<OrchestratorRunView>;
    /** List every run, newest first. */
    listRuns(): Promise<readonly OrchestratorRunView[]>;
    /** Fetch one run by id. */
    getRun(runId: string): Promise<OrchestratorRunView | null>;
    /** Stream the full run list on every durable change. */
    watch(signal: AbortSignal): AsyncIterable<readonly OrchestratorRunView[]>;
    /** Cancel a live run. */
    cancel(runId: string): Promise<void>;
    /**
     * Apply the reviewed proposal. `hash` must equal the diff hash shown at
     * review time — the service re-validates the worktree before writing.
     */
    apply(runId: string, hash: string): Promise<void>;
    /** Remove a terminal run's worktree and mark the record discarded. */
    discard(runId: string): Promise<void>;
    /** The configured model routes for the UI picker. */
    listRoutes(): Promise<readonly OrchestratorRouteCatalog[]>;
    /** Project a stored record to the wire view (drops recovery-only fields). */
    private view;
}
export default OrchestratorController;
//# sourceMappingURL=index.d.ts.map