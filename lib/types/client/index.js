import orchestratorRemote from 'dsh-orchestrator/remote';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { OrchestratorPanel } from "./OrchestratorPanel.js";
import { en, NS, zh } from "./locales.js";
/** Required services: slot registry, dictionaries, and the Remote carrier. */
export const inject = ['slots', 'locale', 'remote'];
/**
 * @param ctx - Client plugin context: locale, slots, Remote namespaces.
 */
export async function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-orchestrator: dictionaries');
    const unmount = await ctx.remote.$mount(orchestratorRemote);
    ctx.effect(() => unmount, 'ui-orchestrator: remote namespace');
    const remote = ctx.remote;
    const runs = createSnapshotStore(undefined);
    const stream = remote.$stream({
        name: 'orchestrator',
        open: (signal) => remote.orchestrator.watch(signal),
        ended: () => new Error('orchestrator stream ended'),
    });
    let disposed = false;
    ctx.effect(() => () => { disposed = true; return stream.dispose(); }, 'ui-orchestrator: run stream');
    void (async () => {
        for await (const frame of stream) {
            runs.set([...frame.value].sort((a, b) => b.createdAt - a.createdAt));
            frame.accept();
        }
    })().catch(() => {
        // A disabled or absent Host plugin rejects the watch open: publish the
        // empty list, which the panel renders as the feature-off state.
        if (!disposed)
            runs.set([]);
    });
    const wrap = async (call) => {
        const result = call;
        const value = await result;
        if (value !== undefined && typeof value === 'object' && 'ok' in value && value.ok === false) {
            throw new Error('remote call failed');
        }
    };
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'orchestrator',
        locale: NS,
        inject: () => ({
            hooks: { runs },
            submit: async (input) => wrap(remote.orchestrator.submit({ task: input.task, cwd: input.cwd })),
            cancel: runId => wrap(remote.orchestrator.cancel(runId)),
            apply: (runId, hash) => wrap(remote.orchestrator.apply(runId, hash)),
            discard: runId => wrap(remote.orchestrator.discard(runId)),
        }),
    }, OrchestratorPanel));
}
//# sourceMappingURL=index.js.map