/**
 * Prompt builders for the three orchestration roles. Each child gets a
 * self-contained instruction — spawned children see no parent history.
 * @module dsh-orchestrator/prompts
 */
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import type { GraphNode, Plan } from './graph.ts';
import type { OrchestratorMode } from './types.ts';
/** Catalog line the planner can route from: `provider` + comma-separated models. */
export interface PlannerCatalogEntry {
    readonly provider: string;
    readonly models: readonly string[];
}
/**
 * Build the planner instruction. The planner is read-only by convention: it
 * decomposes and routes, it does not edit.
 * @param task - the user's task.
 * @param mode - requested strategy hint.
 * @param catalog - provider routes with model ids the plan may reference.
 * @param maxNodes - hard cap the planner must respect.
 */
export declare function plannerPrompt(task: string, mode: OrchestratorMode, catalog: readonly PlannerCatalogEntry[], maxNodes: number): string;
/**
 * Build a worker/aggregate node prompt. Dependency outputs are inlined so the
 * child needs no cross-session reads.
 */
export declare function nodePrompt(node: GraphNode, runTask: string, depOutputs: ReadonlyMap<string, string>): string;
/** Structured schema handed to the validator subagent. */
export declare const VALIDATION_OUTPUT_SCHEMA: ObjectJsonSchema;
/**
 * Build the validator instruction over the run's outputs and diff stat.
 * @param task - the original user task.
 * @param nodes - terminal plan nodes (the validator itself excluded).
 * @param diffStat - `git diff --stat` of the prepared proposal.
 */
export declare function validatorPrompt(task: string, nodes: readonly GraphNode[], diffStat: string): string;
/** Normalize planner output received as `unknown` into the {@link Plan} type. */
export declare function coercePlan(value: unknown): Plan;
//# sourceMappingURL=prompts.d.ts.map