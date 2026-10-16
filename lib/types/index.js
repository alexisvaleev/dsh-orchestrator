/**
 * Host owner of the `orchestrator` Remote namespace: accepts one complex
 * development task, plans it into isolated subagent delegations, validates the
 * combined result, and prepares a worktree diff that applies only through an
 * exact-hash approval. All writes happen inside a per-run git worktree; the
 * user's workspace is untouched until {@link apply} revalidates the reviewed
 * diff.
 * @module dsh-orchestrator
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { OrchestratorEngine } from "./engine.js";
import { SubagentDriver } from "./driver.js";
import { ORCHESTRATOR_DOMAIN } from "./domain.js";
export { ORCHESTRATOR_DOMAIN } from "./domain.js";
const routeSchema = z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
});
/** Default worktree root when the deployment does not configure one. */
function defaultWorktreeRoot() {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(home, 'orchestrator');
}
/** Host service backing the generated `ctx.remote.orchestrator` namespace. */
let OrchestratorController = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _submit_decorators;
    let _listRuns_decorators;
    let _getRun_decorators;
    let _watch_decorators;
    let _cancel_decorators;
    let _apply_decorators;
    let _discard_decorators;
    let _listRoutes_decorators;
    return class OrchestratorController extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _submit_decorators = [Remote];
            _listRuns_decorators = [Remote];
            _getRun_decorators = [Remote];
            _watch_decorators = [Remote({ mode: 'stream' })];
            _cancel_decorators = [Remote];
            _apply_decorators = [Remote];
            _discard_decorators = [Remote];
            _listRoutes_decorators = [Remote];
            __esDecorate(this, null, _submit_decorators, { kind: "method", name: "submit", static: false, private: false, access: { has: obj => "submit" in obj, get: obj => obj.submit }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listRuns_decorators, { kind: "method", name: "listRuns", static: false, private: false, access: { has: obj => "listRuns" in obj, get: obj => obj.listRuns }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getRun_decorators, { kind: "method", name: "getRun", static: false, private: false, access: { has: obj => "getRun" in obj, get: obj => obj.getRun }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _watch_decorators, { kind: "method", name: "watch", static: false, private: false, access: { has: obj => "watch" in obj, get: obj => obj.watch }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _cancel_decorators, { kind: "method", name: "cancel", static: false, private: false, access: { has: obj => "cancel" in obj, get: obj => obj.cancel }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _apply_decorators, { kind: "method", name: "apply", static: false, private: false, access: { has: obj => "apply" in obj, get: obj => obj.apply }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _discard_decorators, { kind: "method", name: "discard", static: false, private: false, access: { has: obj => "discard" in obj, get: obj => obj.discard }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listRoutes_decorators, { kind: "method", name: "listRoutes", static: false, private: false, access: { has: obj => "listRoutes" in obj, get: obj => obj.listRoutes }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        config = __runInitializers(this, _instanceExtraInitializers);
        static inject = ['typert', 'subagents', 'agents', 'storageDomain', 'subprocess', 'llm', 'tools'];
        static Config = z.object({
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
        });
        /** Resolved once the domain is open, stale runs are marked, and the engine is live. */
        ready;
        engine;
        domain;
        constructor(ctx, config) {
            super(ctx, 'orchestratorController', { namespace: 'orchestrator' });
            this.config = config;
            this.ready = this.init(ctx);
        }
        async init(ctx) {
            const domain = await ctx.storageDomain.open(ORCHESTRATOR_DOMAIN);
            this.domain = domain;
            ctx.effect(() => () => domain.close());
            const table = domain.table('runs');
            for (const [id, record] of table.entries()) {
                if (record.status === 'planning' || record.status === 'running') {
                    await table.put(id, { ...record, status: 'interrupted', error: 'host restarted mid-run', updatedAt: Date.now() });
                }
            }
            const persist = async (record) => {
                await table.put(record.id, record);
            };
            const config = this.config;
            const driver = new SubagentDriver(ctx.subagents, config.subagentProvider ?? 'spawn', config.maxDepth);
            const deps = {
                driver,
                agents: {
                    create: (options) => ctx.agents.create({
                        sessionId: options.sessionId,
                        meta: options.meta,
                        ...(options.parentAgent !== undefined ? { parentAgent: options.parentAgent } : {}),
                        ...(options.agentOptions !== undefined
                            ? { agentOptions: options.agentOptions }
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
            };
            this.engine = new OrchestratorEngine(deps);
            const engine = this.engine;
            ctx.effect(() => ctx.tools.register(defineTool({
                name: 'orchestrate',
                description: 'Decompose a complex development task into isolated sub-agent runs inside a git worktree, execute them in parallel, validate the combined result, and propose a diff that applies only after the user approves it in the Orchestrator panel.',
                parameters: {
                    task: { type: 'string', required: true, description: 'The complex development task.' },
                    cwd: { type: 'string', description: 'Absolute path of the target git repository. Defaults to the current workspace.' },
                },
                output: {
                    schema: { type: 'string' },
                    render: (_args, value) => [{ type: 'text', text: value }],
                },
                async execute(args, exec) {
                    const cwd = args.cwd ?? exec.agent?.session.header.cwd;
                    if (cwd === undefined || cwd === null)
                        throw new Error('no cwd given and the calling session has none');
                    const record = await engine.submit({ task: args.task, cwd }, exec.agent);
                    return `orchestration run ${record.id} started; approve the proposed diff in the Orchestrator panel when it appears`;
                },
                presentCall: () => ({ card: 'generic', title: 'Orchestrate task', kind: 'other' }),
            })));
        }
        async catalog() {
            const entries = [];
            for (const provider of this.config.routeProviders ?? []) {
                const models = await this.ctx.llm.listModels(provider);
                entries.push({ provider, models: models.map((m) => m.id) });
            }
            return entries;
        }
        /** Submit a new orchestration run. @returns the created run record. */
        async submit(input) {
            await this.ready;
            if (typeof input?.task !== 'string' || input.task.trim().length === 0) {
                throw new Error('submit requires a non-empty task');
            }
            if (typeof input.cwd !== 'string' || !input.cwd.startsWith('/')) {
                throw new Error('submit requires an absolute cwd');
            }
            const record = await this.engine.submit(input);
            return this.view(record);
        }
        /** List every run, newest first. */
        async listRuns() {
            await this.ready;
            const table = this.domain.table('runs');
            return [...table.entries()]
                .map(([, record]) => record)
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((record) => this.view(record));
        }
        /** Fetch one run by id. */
        async getRun(runId) {
            await this.ready;
            const record = this.domain.table('runs').get(runId);
            return record === undefined ? null : this.view(record);
        }
        /** Stream the full run list on every durable change. */
        async *watch(signal) {
            await this.ready;
            const push = async function* (controller) {
                yield await controller.listRuns();
                const queue = [];
                const off = controller.ctx.on('domain/changed', (event) => {
                    if (event.domain === 'orchestrator') {
                        const wake = queue.shift();
                        wake?.();
                    }
                });
                try {
                    while (!signal.aborted) {
                        await new Promise((resolve) => queue.push(resolve));
                        if (signal.aborted)
                            break;
                        yield await controller.listRuns();
                    }
                }
                finally {
                    off();
                }
            };
            yield* push(this);
        }
        /** Cancel a live run. */
        async cancel(runId) {
            await this.ready;
            const record = this.domain.table('runs').get(runId);
            if (record === undefined)
                throw new Error(`unknown run ${runId}`);
            await this.engine.cancel(runId);
        }
        /**
         * Apply the reviewed proposal. `hash` must equal the diff hash shown at
         * review time — the service re-validates the worktree before writing.
         */
        async apply(runId, hash) {
            await this.ready;
            const table = this.domain.table('runs');
            const record = table.get(runId);
            if (record === undefined)
                throw new Error(`unknown run ${runId}`);
            await this.engine.apply(runId, hash, record);
            await table.put(runId, { ...record, status: 'applied', updatedAt: Date.now() });
        }
        /** Remove a terminal run's worktree and mark the record discarded. */
        async discard(runId) {
            await this.ready;
            const table = this.domain.table('runs');
            const record = table.get(runId);
            if (record === undefined)
                throw new Error(`unknown run ${runId}`);
            await this.engine.discard(runId, record);
            await table.put(runId, { ...record, worktree: null, updatedAt: Date.now() });
        }
        /** The configured model routes for the UI picker. */
        async listRoutes() {
            await this.ready;
            const catalog = await this.catalog();
            return catalog.map((entry) => ({
                provider: entry.provider,
                models: entry.models.map((id) => ({ id, name: null })),
            }));
        }
        /** Project a stored record to the wire view (drops recovery-only fields). */
        view(record) {
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
            };
        }
    };
})();
export { OrchestratorController };
export default OrchestratorController;
//# sourceMappingURL=index.js.map