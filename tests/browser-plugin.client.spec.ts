/**
 * ui-orchestrator plugin halves: the browser entry's dictionary and
 * sidebar-footer registrations against the real SlotRegistry (with fiber
 * teardown proving removal — HMR safety), the stream-fed run store, injected
 * action routing onto the `orchestrator` Remote methods, and the inert node
 * entry.
 */
import { Context } from '@deepseek-ai/cordis'
import type { OrchestratorRunView } from 'dsh-orchestrator/types'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { fakeLocale } from './helpers.ts'
import { apply, inject } from '../src/client/index.ts'
import type { OrchestratorInjected } from '../src/client/OrchestratorPanel.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

/** Slot ledger reader: entry ids currently registered in the sidebar footer list. */
function footerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('sidebar.footer.action')
    .map(entry => entry.options.id)
}

/** Run fixture pushed through the fake Remote stream. */
const NOW = 1_760_000_000
const RUN: OrchestratorRunView = {
  id: 'run-1',
  task: 'split the parser crate',
  cwd: '/repo',
  status: 'awaiting-approval',
  createdAt: NOW,
  updatedAt: NOW,
  mode: 'parallel',
  nodes: [],
  proposal: {
    baseRev: 'abc123',
    stat: ' 1 file changed, 2 insertions(+)\n',
    diff: 'diff --git a/x b/x\n+new\n',
    hash: 'h',
  },
  validation: { verdict: 'pass', summary: 'looks consistent' },
  error: null,
}

/** The `$stream` options the plugin passes; the fake records open/ended use. */
interface StreamOptions {
  name: string
  open: (signal: AbortSignal) => AsyncIterable<unknown>
  ended: () => Error
}

/** One pushable RemoteStream stand-in. */
interface FakeStream {
  push(item: readonly OrchestratorRunView[]): void
  dispose(): Promise<void>
  [Symbol.asyncIterator](): AsyncIterator<unknown>
}

interface FakeRemote {
  $stream: (options: StreamOptions) => FakeStream
  submit: ReturnType<typeof vi.fn>
  listRuns: ReturnType<typeof vi.fn>
  watch: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  apply: ReturnType<typeof vi.fn>
  discard: ReturnType<typeof vi.fn>
}

function makeFakeStream(): { stream: FakeStream; remote: FakeRemote } {
  const queue: readonly OrchestratorRunView[][] = []
  let waiting: ((result: IteratorResult<unknown>) => void) | undefined
  let ended = false
  const stream: FakeStream = {
    dispose: () => {
      ended = true
      waiting?.({ value: undefined, done: true })
      waiting = undefined
      return Promise.resolve()
    },
    push: (item) => {
      if (waiting === undefined) queue.push(item)
      else {
        const resolve = waiting
        waiting = undefined
        resolve({ value: { generation: 1, value: item, signal: new AbortController().signal, accept: () => {} }, done: false })
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) {
            const value = queue.shift()!
            return Promise.resolve({ value: { generation: 1, value, signal: new AbortController().signal, accept: () => {} }, done: false })
          }
          if (ended) return Promise.resolve({ value: undefined, done: true })
          return new Promise<IteratorResult<unknown>>((resolve) => { waiting = resolve })
        },
        return: () => Promise.resolve({ value: undefined, done: true }),
      }
    },
  }
  const remote: FakeRemote = {
    $stream: (options) => {
      void options.open(new AbortController().signal)
      void options.ended()
      return stream
    },
    submit: vi.fn(async () => ({ ok: true as const, value: RUN })),
    listRuns: vi.fn(async () => ({ ok: true as const, value: [RUN] })),
    watch: vi.fn(),
    cancel: vi.fn(async () => ({ ok: true as const })),
    apply: vi.fn(async () => ({ ok: true as const })),
    discard: vi.fn(async () => ({ ok: true as const })),
  }
  return { stream, remote }
}

/** Boot the browser half over a real slot tree that declares the footer list. */
async function bench(): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  stream: FakeStream
  remote: FakeRemote
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const { stream, remote } = makeFakeStream()
  ctx.provide('remote', {
    $on: () => () => {},
    $stream: remote.$stream,
    $mount: () => Promise.resolve(() => {}),
    orchestrator: {
      submit: remote.submit,
      listRuns: remote.listRuns,
      getRun: vi.fn(async () => ({ ok: true, value: RUN })),
      watch: remote.watch,
      cancel: remote.cancel,
      apply: remote.apply,
      discard: remote.discard,
      listRoutes: vi.fn(async () => ({ ok: true, value: [] })),
    },
  } as never)
  ctx.provide('theme', { getTheme: () => ({ name: 'light' }) } as never)
  ctx.provide('locale', fakeLocale() as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, stream, remote }
}

/** Pull the injected face out of the registered footer entry. */
function injected(ctx: Context): OrchestratorInjected {
  const entry = ctx.slots
    .entries('sidebar.footer.action')
    .find(candidate => candidate.options.id === 'orchestrator')
  const injectFace = entry?.inject as (() => OrchestratorInjected) | undefined
  if (injectFace === undefined) throw new Error('orchestrator entry registered no inject face')
  return injectFace()
}

describe('ui-orchestrator browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote'])
  })

  it('registers the sidebar footer action, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(footerEntryIds(ctx)).toContain('orchestrator')
    await fiber.dispose()
    expect(footerEntryIds(ctx)).not.toContain('orchestrator')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    ctx.locale.setLocale('zh')
    const translate = ctx.locale.bind(NS)
    expect(translate('panel.title')).toBe(zh['panel.title'])
    ctx.locale.setLocale('en')
    expect(translate('panel.title')).toBe(en['panel.title'])

    await fiber.dispose()
    expect(translate('panel.title')).not.toBe(en['panel.title'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('feeds watch frames into the injected runs hook, newest first', async () => {
    const { ctx, stream } = await bench()
    const face = injected(ctx)
    expect(face.hooks.runs.getSnapshot()).toBeUndefined()

    const older = { ...RUN, id: 'run-0', createdAt: NOW - 1000 }
    stream.push([older, RUN])
    await vi.waitFor(() => {
      const runs = face.hooks.runs.getSnapshot()
      expect(runs?.map(r => r.id)).toEqual(['run-1', 'run-0'])
    })
  })

  it('routes submit/cancel/apply/discard onto the orchestrator Remote methods', async () => {
    const { ctx, remote } = await bench()
    const face = injected(ctx)

    await face.submit({ task: 't', cwd: '/repo' })
    expect(remote.submit).toHaveBeenCalledWith({ task: 't', cwd: '/repo' })
    await face.cancel('run-1')
    expect(remote.cancel).toHaveBeenCalledWith('run-1')
    await face.apply('run-1', 'h')
    expect(remote.apply).toHaveBeenCalledWith('run-1', 'h')
    await face.discard('run-1')
    expect(remote.discard).toHaveBeenCalledWith('run-1')
  })
})
