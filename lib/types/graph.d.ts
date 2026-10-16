/**
 * Plan schema and the DAG state machine the engine schedules over. The module
 * is deliberately free of Cordis, subprocess, and model access so every
 * scheduling invariant is unit-testable.
 * @module dsh-orchestrator/graph
 */
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import type { OrchestratorModelRoute } from './types.ts';
/** Object-rooted JSON schema handed to the planner subagent as `outputSchema`. */
export declare const PLAN_OUTPUT_SCHEMA: ObjectJsonSchema;
/** One task inside the planner's structured output. */
export interface PlanTask {
    readonly id: string;
    readonly title: string;
    readonly prompt: string;
    readonly kind?: 'work' | 'aggregate';
    readonly deps?: readonly string[];
    readonly route?: OrchestratorModelRoute;
}
/** The planner's structured output. */
export interface Plan {
    readonly tasks: readonly PlanTask[];
    readonly notes?: string;
}
/** Runtime state of one node inside the engine's graph. */
export interface GraphNode {
    readonly id: string;
    readonly title: string;
    readonly prompt: string;
    /** Display parentage for aggregate nodes; scheduling reads `deps`, never this. */
    parentId: string | null;
    readonly deps: readonly string[];
    readonly role: 'worker' | 'aggregate' | 'validator';
    readonly route: OrchestratorModelRoute;
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    attempts: number;
    output: string | null;
    error: string | null;
    /** When true, deps gate on terminal state instead of `done` (used by the validator). */
    readonly waitForSettled: boolean;
}
/** Structured plan is trusted data only after these invariants are re-checked in-plugin. */
export declare class PlanError extends Error {
    constructor(message: string);
}
/**
 * Validate and flatten planner output into the runtime graph. Rejects empty
 * plans, duplicate or unknown ids, cycles, and node counts above `maxNodes`.
 * @param plan - the planner's structured output.
 * @param options - limits and the worker route fallback applied to plan tasks.
 * @returns graph nodes keyed by task id.
 */
export declare function buildGraph(plan: Plan, options: {
    maxNodes: number;
    workerRoute: OrchestratorModelRoute;
    /** Provider names the planner may route through; unset means "no catalog constraint". */
    allowedProviders?: ReadonlySet<string>;
}): Map<string, GraphNode>;
/** Node ids the engine owns; planner output may not use them. */
export declare const RESERVED_NODE_IDS: ReadonlySet<string>;
/** Append the engine-owned validator node depending on every plan node. */
export declare function attachValidator(nodes: Map<string, GraphNode>, route: OrchestratorModelRoute): GraphNode;
/** Nodes whose dependencies are satisfied and may start now. */
export declare function readyNodes(nodes: Map<string, GraphNode>): GraphNode[];
/**
 * Mark nodes unreachable because a hard dependency failed or was skipped.
 * Returns the ids newly marked `skipped`; repeats until the cascade settles.
 */
export declare function cascadeSkipped(nodes: Map<string, GraphNode>): string[];
/** Whether every node reached a terminal state. */
export declare function isSettled(nodes: Map<string, GraphNode>): boolean;
/** Ids of nodes that ended `failed` — used for the run-level error summary. */
export declare function failedNodes(nodes: Map<string, GraphNode>): GraphNode[];
//# sourceMappingURL=graph.d.ts.map