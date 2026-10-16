/**
 * Plan schema and the DAG state machine the engine schedules over. The module
 * is deliberately free of Cordis, subprocess, and model access so every
 * scheduling invariant is unit-testable.
 * @module dsh-orchestrator/graph
 */
/** Object-rooted JSON schema handed to the planner subagent as `outputSchema`. */
export const PLAN_OUTPUT_SCHEMA = {
    type: 'object',
    required: ['tasks'],
    additionalProperties: false,
    properties: {
        tasks: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'title', 'prompt'],
                additionalProperties: false,
                properties: {
                    id: { type: 'string', description: 'Stable task id, unique inside this plan.' },
                    title: { type: 'string', description: 'Short human-readable task title.' },
                    prompt: {
                        type: 'string',
                        description: 'Self-contained instruction for the worker agent, including file scope and acceptance criteria.',
                    },
                    kind: {
                        enum: ['work', 'aggregate'],
                        description: '`aggregate` nodes run after their deps and synthesize dep outputs; `work` nodes edit the shared worktree.',
                    },
                    deps: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ids of tasks that must complete first. Omit for independent (parallel) tasks.',
                    },
                    route: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            provider: { type: 'string' },
                            model: { type: 'string' },
                            reasoningEffort: { type: 'string' },
                        },
                        description: 'Model route override for this task, chosen from the supplied catalog.',
                    },
                },
            },
        },
        notes: { type: 'string', description: 'Optional planner rationale, shown to the user.' },
    },
};
/** Structured plan is trusted data only after these invariants are re-checked in-plugin. */
export class PlanError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PlanError';
    }
}
/**
 * Validate and flatten planner output into the runtime graph. Rejects empty
 * plans, duplicate or unknown ids, cycles, and node counts above `maxNodes`.
 * @param plan - the planner's structured output.
 * @param options - limits and the worker route fallback applied to plan tasks.
 * @returns graph nodes keyed by task id.
 */
export function buildGraph(plan, options) {
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
        throw new PlanError('planner returned no tasks');
    }
    if (plan.tasks.length > options.maxNodes) {
        throw new PlanError(`planner returned ${plan.tasks.length} tasks; the configured limit is ${options.maxNodes}`);
    }
    const nodes = new Map();
    for (const task of plan.tasks) {
        if (typeof task.id !== 'string' || task.id.length === 0 || nodes.has(task.id)
            || RESERVED_NODE_IDS.has(task.id)) {
            throw new PlanError(`invalid or duplicate task id: ${String(task.id)}`);
        }
        nodes.set(task.id, {
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            parentId: null,
            deps: task.deps ?? [],
            role: task.kind === 'aggregate' ? 'aggregate' : 'worker',
            route: task.route ?? options.workerRoute,
            status: 'pending',
            attempts: 0,
            output: null,
            error: null,
            waitForSettled: false,
        });
    }
    for (const node of nodes.values()) {
        for (const dep of node.deps) {
            if (!nodes.has(dep))
                throw new PlanError(`task '${node.id}' depends on unknown task '${dep}'`);
        }
        const provider = node.route.provider;
        if (provider !== undefined && options.allowedProviders !== undefined && !options.allowedProviders.has(provider)) {
            throw new PlanError(`task '${node.id}' routes to provider '${provider}' outside the configured catalog`);
        }
    }
    assertAcyclic(nodes);
    // Aggregate nodes get parentage for the UI: the nearest dependents chain is
    // not a tree in general, so parentId records the first dep solely for display.
    for (const node of nodes.values()) {
        if (node.role === 'aggregate')
            node.parentId = node.deps[0] ?? null;
    }
    return nodes;
}
/** Reject dependency cycles before the scheduler can deadlock on them. */
function assertAcyclic(nodes) {
    const visiting = new Set();
    const done = new Set();
    const visit = (id) => {
        if (done.has(id))
            return;
        if (visiting.has(id))
            throw new PlanError(`dependency cycle involving task '${id}'`);
        visiting.add(id);
        for (const dep of nodes.get(id).deps)
            visit(dep);
        visiting.delete(id);
        done.add(id);
    };
    for (const id of nodes.keys())
        visit(id);
}
/** Node ids the engine owns; planner output may not use them. */
export const RESERVED_NODE_IDS = new Set(['__validate__']);
/** Append the engine-owned validator node depending on every plan node. */
export function attachValidator(nodes, route) {
    const validator = {
        id: '__validate__',
        title: 'Validate results',
        prompt: '',
        parentId: null,
        deps: [...nodes.keys()],
        role: 'validator',
        route,
        status: 'pending',
        attempts: 0,
        output: null,
        error: null,
        waitForSettled: true,
    };
    nodes.set(validator.id, validator);
    return validator;
}
/** Nodes whose dependencies are satisfied and may start now. */
export function readyNodes(nodes) {
    const ready = [];
    for (const node of nodes.values()) {
        if (node.status !== 'pending')
            continue;
        const satisfied = node.deps.every((dep) => {
            const depNode = nodes.get(dep);
            return node.waitForSettled
                ? depNode.status !== 'pending' && depNode.status !== 'running'
                : depNode.status === 'done';
        });
        if (satisfied)
            ready.push(node);
    }
    return ready;
}
/**
 * Mark nodes unreachable because a hard dependency failed or was skipped.
 * Returns the ids newly marked `skipped`; repeats until the cascade settles.
 */
export function cascadeSkipped(nodes) {
    const skipped = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of nodes.values()) {
            if (node.status !== 'pending' || node.waitForSettled)
                continue;
            if (node.deps.some((dep) => {
                const depNode = nodes.get(dep);
                return depNode.status === 'failed' || depNode.status === 'skipped';
            })) {
                node.status = 'skipped';
                skipped.push(node.id);
                changed = true;
            }
        }
    }
    return skipped;
}
/** Whether every node reached a terminal state. */
export function isSettled(nodes) {
    for (const node of nodes.values()) {
        if (node.status === 'pending' || node.status === 'running')
            return false;
    }
    return true;
}
/** Ids of nodes that ended `failed` — used for the run-level error summary. */
export function failedNodes(nodes) {
    return [...nodes.values()].filter((node) => node.status === 'failed');
}
//# sourceMappingURL=graph.js.map