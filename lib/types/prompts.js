/**
 * Prompt builders for the three orchestration roles. Each child gets a
 * self-contained instruction — spawned children see no parent history.
 * @module dsh-orchestrator/prompts
 */
/** Cap on dependency output text inlined into a downstream prompt. */
const DEP_OUTPUT_LIMIT = 8_000;
/**
 * Build the planner instruction. The planner is read-only by convention: it
 * decomposes and routes, it does not edit.
 * @param task - the user's task.
 * @param mode - requested strategy hint.
 * @param catalog - provider routes with model ids the plan may reference.
 * @param maxNodes - hard cap the planner must respect.
 */
export function plannerPrompt(task, mode, catalog, maxNodes) {
    const catalogText = catalog.length === 0
        ? 'No explicit model catalog is available; omit `route` on every task.'
        : catalog.map((entry) => `- ${entry.provider}: ${entry.models.join(', ')}`).join('\n');
    const strategy = mode === 'parallel'
        ? 'Produce only independent tasks (no `deps`) so they can execute fully in parallel.'
        : mode === 'hierarchical'
            ? 'Produce a hierarchy: independent work tasks first, then `aggregate` tasks (kind "aggregate") that depend on related groups and synthesize their results.'
            : 'Choose the structure that fits the task: independent tasks run in parallel; use `deps` for ordering and `aggregate` tasks to synthesize groups of results.';
    return `You are the planner of a multi-agent orchestration run inside a git worktree.

Decompose the task below into at most ${maxNodes} subtasks for worker agents. ${strategy}

Rules:
- Every worker task must be self-contained: the worker sees ONLY its prompt, not this conversation.
- Assign each work task a disjoint file scope where possible — parallel workers share one worktree and overlapping edits conflict.
- Worker prompts must state concrete acceptance criteria.
- Use \`aggregate\` tasks to synthesize finished groups, not to edit files.
- Optionally pick a per-task \`route\` ONLY from this model catalog (provider + model). Assign stronger models to harder tasks.
${catalogText}

Return the structured plan only.

Task:
${task}`;
}
/**
 * Build a worker/aggregate node prompt. Dependency outputs are inlined so the
 * child needs no cross-session reads.
 */
export function nodePrompt(node, runTask, depOutputs) {
    const depSection = node.deps.length === 0
        ? ''
        : `\n\nCompleted dependency results (read-only context):\n${node.deps.map((dep) => {
            const output = depOutputs.get(dep) ?? '(no output)';
            const clipped = output.length > DEP_OUTPUT_LIMIT ? `${output.slice(0, DEP_OUTPUT_LIMIT)}\n…(truncated)` : output;
            return `--- ${dep} ---\n${clipped}`;
        }).join('\n')}`;
    const aggregateNote = node.role === 'aggregate'
        ? '\nYou are an aggregator: synthesize the dependency results into a coherent answer. Do not edit files.'
        : '\nEdit files directly in your working directory (a git worktree). Keep changes inside the scope described above.';
    return `Overall task: ${runTask}\n\nYour subtask (${node.id}): ${node.title}\n\n${node.prompt}${depSection}${aggregateNote}`;
}
/** Structured schema handed to the validator subagent. */
export const VALIDATION_OUTPUT_SCHEMA = {
    type: 'object',
    required: ['verdict', 'summary'],
    additionalProperties: false,
    properties: {
        verdict: { enum: ['pass', 'fail'], description: 'pass only when the changes plausibly satisfy the task.' },
        summary: { type: 'string' },
        issues: { type: 'array', items: { type: 'string' } },
    },
};
/**
 * Build the validator instruction over the run's outputs and diff stat.
 * @param task - the original user task.
 * @param nodes - terminal plan nodes (the validator itself excluded).
 * @param diffStat - `git diff --stat` of the prepared proposal.
 */
export function validatorPrompt(task, nodes, diffStat) {
    const results = nodes.map((node) => {
        const output = node.output ?? node.error ?? '(no output)';
        const clipped = output.length > DEP_OUTPUT_LIMIT ? `${output.slice(0, DEP_OUTPUT_LIMIT)}\n…(truncated)` : output;
        return `--- ${node.id} (${node.status}) ---\n${clipped}`;
    }).join('\n');
    return `You are the validator of a multi-agent orchestration run. Decide whether the combined results and the prepared diff plausibly satisfy the task. Fail on unresolved subtasks, contradictions, or empty/irrelevant diffs.

Task:
${task}

Subtask results:
${results}

Prepared diff stat:
${diffStat || '(empty)'}

Return the structured verdict only.`;
}
/** Normalize planner output received as `unknown` into the {@link Plan} type. */
export function coercePlan(value) {
    if (typeof value !== 'object' || value === null || !Array.isArray(value.tasks)) {
        throw new Error('planner structured output is not a plan object');
    }
    for (const task of value.tasks) {
        if (typeof task !== 'object' || task === null
            || typeof task.id !== 'string' || typeof task.title !== 'string' || typeof task.prompt !== 'string'
            || (task.deps !== undefined && (!Array.isArray(task.deps) || task.deps.some(dep => typeof dep !== 'string')))) {
            throw new Error(`planner task is malformed: ${JSON.stringify(task?.id ?? task)}`);
        }
    }
    return value;
}
//# sourceMappingURL=prompts.js.map