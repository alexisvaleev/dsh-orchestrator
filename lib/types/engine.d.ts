/**
 * The orchestration engine: plan → schedule → delegate → validate → propose.
 * Every external capability arrives through the injected {@link EngineDeps}
 * seam so the run loop is testable without a live Host.
 * @module dsh-orchestrator/engine
 */
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import type { OrchestratorDriver } from './driver.ts';
import { type PlannerCatalogEntry } from './prompts.ts';
import type { OrchestratorRunRecord } from './domain.ts';
import type { OrchestratorModelRoute, OrchestratorSubmitInput } from './types.ts';
/** Minimal agent-factory surface the engine requires from `ctx.agents`. */
export interface EngineAgentFactory {
    create(options: {
        sessionId: SessionId;
        parentAgent?: Agent;
        meta: {
            cwd: string;
        };
        agentOptions?: {
            provider?: string;
            model?: string;
            reasoningEffort?: string;
        };
        signal?: AbortSignal;
    }): Promise<AgentHandle>;
}
/** Everything the engine borrows from the Host or substitutes in tests. */
export interface EngineDeps {
    /** Provider-agnostic delegation driver. */
    readonly driver: OrchestratorDriver;
    /** Creates the run's root orchestrator agent (the subagent parent anchor). */
    readonly agents: EngineAgentFactory;
    /** Host subprocess service for git plumbing. */
    readonly subprocess: SubprocessRuntime;
    /** Durable record write — called after every transition. */
    readonly persist: (record: OrchestratorRunRecord) => Promise<void>;
    /** Directory run worktrees are created under. */
    readonly worktreeRoot: string;
    /** Max nodes executing concurrently per run. */
    readonly maxConcurrency: number;
    /** Max plan tasks accepted from the planner. */
    readonly maxNodes: number;
    /** Max attempts per node, including the first. */
    readonly maxAttempts: number;
    /** Per-attempt timeout in milliseconds. */
    readonly nodeTimeoutMs: number;
    /** Tool names denied to every delegated node. */
    readonly toolDeny: readonly string[];
    /** Effective routes per role after Config and submit-input resolution. */
    readonly routes: {
        readonly planner: OrchestratorModelRoute;
        readonly worker: OrchestratorModelRoute;
        readonly validator: OrchestratorModelRoute;
    };
    /** Model catalog snapshot for the planner prompt and route validation. */
    readonly catalog: () => Promise<readonly PlannerCatalogEntry[]>;
}
/**
 * Runs orchestration over submitted tasks. The engine owns no plugin
 * lifecycle — callers persist and dispose it with the owning service.
 */
export declare class OrchestratorEngine {
    private readonly deps;
    private readonly live;
    constructor(deps: EngineDeps);
    /**
     * Create the durable record and launch the run in the background.
     * @returns the freshly persisted run record (status `planning`).
     */
    submit(input: OrchestratorSubmitInput, parentAgent?: Agent): Promise<OrchestratorRunRecord>;
    /** Abort in-flight work and settle the run as `cancelled`. */
    cancel(runId: string): Promise<void>;
    /**
     * Apply the reviewed proposal into the target repository. The hash binds the
     * approval to the exact diff the user saw; a stale worktree or a moved HEAD
     * rejects before anything is written.
     * @param runId - the run in `awaiting-approval`.
     * @param hash - the sha256 the UI displayed at review time.
     * @param record - the current durable record (fetched by the caller).
     */
    apply(runId: string, hash: string, record: OrchestratorRunRecord): Promise<void>;
    /**
     * Remove the run's worktree. Only valid once the run is terminal. The
     * directory is left in place when git refuses — nothing is force-deleted.
     */
    discard(runId: string, record: OrchestratorRunRecord): Promise<void>;
    /** The live controller of a running run, for cancel wiring and tests. */
    liveRun(runId: string): {
        abort: AbortController;
        done: Promise<void>;
    } | undefined;
    /** The full run lifecycle after the record exists. */
    private execute;
    /**
     * One delegation attempt through the driver. The attempt timeout composes
     * with the run abort; the delegated run is always disposed.
     */
    private dispatch;
    /** Map a route into the factory's `agentOptions` vocabulary. */
    private routeOptions;
    /** Project the runtime graph into the stored wire view. */
    private project;
    /** Persist with a refreshed node projection and timestamp. */
    private snapshot;
}
//# sourceMappingURL=engine.d.ts.map