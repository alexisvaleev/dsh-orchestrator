/**
 * Client half of the orchestration feature: registers the `orchestrator`
 * dictionaries, feeds the `orchestrator/watch` Remote stream into a run-list
 * store, and registers the sidebar-footer panel with submit/cancel/apply/
 * discard controls. A Host without the controller rejects the watch; the
 * badge then shows a quiet glyph and an empty panel.
 * @module dsh-ui-orchestrator/client
 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import orchestratorRemote from 'dsh-orchestrator-controller/remote'
import type { OrchestratorRunView, OrchestratorSubmitInput } from 'dsh-orchestrator-controller/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OrchestratorPanel, type OrchestratorInjected } from './OrchestratorPanel.tsx'
import { en, NS, zh, type OrchestratorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Orchestration panel copy. */
    'orchestrator': OrchestratorKey
  }
}

/** Remote namespace typed by the generated client descriptors. */
interface OrchestratorRemote {
  readonly orchestrator: {
    submit(input: OrchestratorSubmitInput): Promise<OrchestratorRunView>
    listRuns(): Promise<readonly OrchestratorRunView[]>
    getRun(runId: string): Promise<OrchestratorRunView | null>
    watch(signal: AbortSignal): AsyncIterable<readonly OrchestratorRunView[]>
    cancel(runId: string): Promise<void>
    apply(runId: string, hash: string): Promise<void>
    discard(runId: string): Promise<void>
    listRoutes(): Promise<readonly { provider: string; models: readonly { id: string; name: string | null }[] }[]>
  }
}

export type { OrchestratorInjected, OrchestratorPanelProps } from './OrchestratorPanel.tsx'

/** Required services: slot registry, dictionaries, and the Remote carrier. */
export const inject = ['slots', 'locale', 'remote']

/**
 * @param ctx - Client plugin context: locale, slots, Remote namespaces.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-orchestrator: dictionaries')
  const unmount = await ctx.remote.$mount(orchestratorRemote)
  ctx.effect(() => unmount, 'ui-orchestrator: remote namespace')

  const remote = (ctx as Context & { remote: Context['remote'] & OrchestratorRemote }).remote
  const runs = createSnapshotStore<readonly OrchestratorRunView[] | undefined>(undefined)
  const stream = remote.$stream<readonly OrchestratorRunView[]>({
    name: 'orchestrator',
    open: (signal: AbortSignal) => remote.orchestrator.watch(signal),
    ended: () => new Error('orchestrator stream ended'),
  })
  let disposed = false
  ctx.effect(() => () => { disposed = true; return stream.dispose() }, 'ui-orchestrator: run stream')
  void (async () => {
    for await (const frame of stream) {
      runs.set([...frame.value].sort((a, b) => b.createdAt - a.createdAt))
      frame.accept()
    }
  })().catch(() => {
    // A disabled or absent Host plugin rejects the watch open: publish the
    // empty list, which the panel renders as the feature-off state.
    if (!disposed) runs.set([])
  })

  const wrap = async (call: Promise<unknown>): Promise<void> => {
    const result = call as Promise<{ ok: boolean } | void>
    const value = await result
    if (value !== undefined && typeof value === 'object' && 'ok' in value && value.ok === false) {
      throw new Error('remote call failed')
    }
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'orchestrator',
    locale: NS,
    inject: (): OrchestratorInjected => ({
      hooks: { runs },
      submit: async input => wrap(remote.orchestrator.submit({ task: input.task, cwd: input.cwd })),
      cancel: runId => wrap(remote.orchestrator.cancel(runId)),
      apply: (runId, hash) => wrap(remote.orchestrator.apply(runId, hash)),
      discard: runId => wrap(remote.orchestrator.discard(runId)),
    }),
  }, OrchestratorPanel))
}
