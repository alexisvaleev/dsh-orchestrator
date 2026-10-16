/**
 * Real-composition test: a genuine cordis Context, the real service class and
 * its inject/effect machinery, an in-memory storageDomain stand-in that emits
 * real 'domain/changed' events, and real git through the subprocess fixture.
 * Only the subagent/model boundary is scripted (the MockDriver).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchestratorController } from '../src/index.ts'
import { MockDriver, fakeAgents, localSubprocess, tmpRepo } from './fixtures.ts'
import type { DriverResult } from '../src/driver.ts'
import type { OrchestratorRunRecord } from '../src/domain.ts'

/** In-memory KvTable + domain facility emitting real cordis events. */
function fakeDomainFacility(ctx: Context) {
  const open = async (spec: { name: string; tables: Record<string, unknown> }) => {
    const maps = new Map<string, Map<string, OrchestratorRunRecord>>()
    const domain = {
      name: spec.name,
      table(name: string) {
        let map = maps.get(name)
        if (map === undefined) {
          map = new Map()
          maps.set(name, map)
        }
        const m = map
        return {
          get: (key: string) => m.get(key),
          entries: () => m.entries(),
          keys: () => m.keys(),
          get size() { return m.size },
          async put(key: string, value: OrchestratorRunRecord) {
            m.set(key, value)
            ctx.emit('domain/changed', { domain: spec.name, table: name, key, operation: 'put', value })
          },
          async delete(key: string) {
            const had = m.delete(key)
            if (had) ctx.emit('domain/changed', { domain: spec.name, table: name, key, operation: 'deleted' })
            return had
          },
          async update(key: string, fn: (v: OrchestratorRunRecord) => OrchestratorRunRecord) {
            const next = fn(m.get(key)!)
            m.set(key, next)
            ctx.emit('domain/changed', { domain: spec.name, table: name, key, operation: 'put', value: next })
            return next
          },
        }
      },
      async close() {},
    }
    return domain
  }
  return { open }
}

const completed = (output = 'ok'): DriverResult => ({ output, stopReason: 'completed', retryable: false })

async function composition() {
  const ctx = new Context()
  const driver = new MockDriver()
  const subprocess = localSubprocess()
  const worktreeRoot = await mkdtemp(join(tmpdir(), 'orch-wt-'))

  ctx.provide('typert', {})
  ctx.provide('subagents', {
    start: async (_name: string, request: { label?: string; prompt: unknown; signal: AbortSignal }) => {
      const suffix = request.label!.split('/').pop()!
      const queued = (driver as unknown as { scripts: Map<string, DriverResult[]> }).scripts.get(suffix)
      const result = queued && queued.length > 0 ? queued.shift()! : { output: `output ${suffix}`, stopReason: 'completed', retryable: false }
      if (suffix === 'w') {
        // The delegated "worker" performs its edit inside the run worktree.
        const runId = request.label!.split('/')[0]!
        await writeFile(join(worktreeRoot, runId, 'hello.ts'), 'export const hi = 1\n')
      }
      return {
        result: Promise.resolve({ output: [{ type: 'text', text: result.output }], structured: result.structured, stopReason: result.stopReason }),
        dispose: () => Promise.resolve(),
        id: 'child-' + suffix,
        localAgent: undefined,
      }
    },
  })
  const agents = fakeAgents()
  ctx.provide('agents', { create: agents.create })
  ctx.provide('storageDomain', fakeDomainFacility(ctx))
  ctx.provide('subprocess', subprocess)
  ctx.provide('llm', { listModels: async (p: string) => [{ id: `${p}-model-1` }] })
  ctx.provide('tools', { register: () => () => {} })

  const fiber = await ctx.plugin(OrchestratorController, {
    routeProviders: ['devin'],
    worktreeRoot,
    nodeTimeoutMs: 10_000,
  })
  const controller = ctx.get('orchestratorController') as OrchestratorController | undefined
    ?? (ctx.orchestratorController as OrchestratorController)
  return { ctx, fiber, controller, driver, subprocess, worktreeRoot }
}

describe('OrchestratorController composition', () => {
  it('serves submit/listRuns/watch/apply/discard over a real Context', async () => {
    const { ctx, fiber, controller, driver, subprocess } = await composition()
    const repo = await tmpRepo(subprocess)

    driver.script('plan', [{
      output: '',
      structured: { tasks: [{ id: 'w', title: 'W', prompt: 'write hello.ts' }] },
      stopReason: 'completed',
      retryable: false,
    }])
    driver.script('__validate__', [{ output: 'pass', structured: { verdict: 'pass', summary: 'ok', issues: [] }, stopReason: 'completed', retryable: false }])

    const submitted = await controller.submit({ task: 'write hello.ts', cwd: repo })
    expect(submitted.status).toBe('planning')

    // Watch stream reflects durable changes.
    const ac = new AbortController()
    const seen: number[] = []
    const watching = (async () => {
      for await (const runs of controller.watch(ac.signal)) {
        seen.push(runs.length)
        if (runs[0]?.status === 'awaiting-approval') break
      }
    })()
    const finalDeadline = Date.now() + 8_000
    while (true) {
      const cur = await controller.getRun(submitted.id)
      if (cur?.status === 'awaiting-approval') break
      if (Date.now() > finalDeadline) throw new Error(`never reached awaiting-approval (last: ${cur?.status})`)
      await new Promise((r) => setTimeout(r, 15))
    }
    await watching
    ac.abort()
    expect(seen.length).toBeGreaterThan(0)

    const ready = (await controller.getRun(submitted.id))!
    expect(ready.proposal?.diff).toContain('hello.ts')
    await expect(controller.apply(submitted.id, 'bad-hash')).rejects.toThrow('hash mismatch')
    await controller.apply(submitted.id, ready.proposal!.hash)
    expect((await controller.getRun(submitted.id))!.status).toBe('applied')
    await controller.discard(submitted.id)
    expect((await controller.getRun(submitted.id))!.worktree).toBeNull()

    await fiber.dispose()
    void ctx
  })
})
