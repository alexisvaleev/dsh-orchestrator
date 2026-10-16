import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OrchestratorEngine } from '../src/engine.ts'
import { engineDeps, tmpRepo, localSubprocess } from './fixtures.ts'
import type { DriverResult } from '../src/driver.ts'

const completed = (output = 'ok'): DriverResult => ({ output, stopReason: 'completed', retryable: false })
const plan = (tasks: unknown[]): DriverResult => ({
  output: '',
  structured: { tasks },
  stopReason: 'completed',
  retryable: false,
})
const pass = { verdict: 'pass', summary: 'looks good', issues: [] }
const verdict = (v: DriverResult = { output: 'pass', structured: pass, stopReason: 'completed', retryable: false }) => v

async function settle(engine: OrchestratorEngine, runId: string): Promise<void> {
  // Settled runs drop their live entry, so a missing controller means done.
  await engine.liveRun(runId)?.done
}

/** Wait until a mock-dispatched request with the given label suffix exists. */
async function untilRequest(driver: { requests: readonly { label: string }[] }, suffix: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!driver.requests.some((r) => r.label.endsWith(`/${suffix}`))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for dispatch of ${suffix}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('OrchestratorEngine', () => {
  it('runs plan → workers → validator and reaches a terminal state', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver, persisted } = await engineDeps()
    const engine = new OrchestratorEngine(deps)
    driver.script('plan', [plan([{ id: 'a', title: 'A', prompt: 'write hello.ts' }])])
    driver.script('a', [completed('created hello.ts')])
    driver.script('__validate__', [verdict()])

    const record = await engine.submit({ task: 'add hello.ts', cwd: repo })
    await settle(engine, record.id)

    const final = persisted.at(-1)!
    // Mock workers write nothing → empty diff → 'done'.
    expect(final.status).toBe('done')
    expect(final.nodes.find((n) => n.id === 'a')?.status).toBe('done')
    expect(final.nodes.find((n) => n.id === '__validate__')?.status).toBe('done')
    expect(final.validation?.verdict).toBe('pass')
    expect(final.worktree).toBe(`${deps.worktreeRoot}/${record.id}`)
    // Planner ran first with the structured-output schema.
    expect(driver.requests[0]!.label).toBe(`${record.id}/plan`)
    expect(driver.requests[0]!.outputSchema).toBeDefined()
  })

  it('executes independent nodes concurrently up to maxConcurrency', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver, persisted } = await engineDeps({ maxConcurrency: 2 })
    const engine = new OrchestratorEngine(deps)

    let running = 0
    let peak = 0
    driver.start = (req) => {
      const suffix = req.label.split('/').pop()!
      if (suffix === 'plan') {
        return Promise.resolve({ result: Promise.resolve(plan([
          { id: 'a', title: 'A', prompt: 'pa' },
          { id: 'b', title: 'B', prompt: 'pb' },
          { id: 'c', title: 'C', prompt: 'pc' },
          { id: 'd', title: 'D', prompt: 'pd' },
        ])), dispose: () => Promise.resolve() })
      }
      if (suffix === '__validate__') {
        return Promise.resolve({ result: Promise.resolve(verdict()), dispose: () => Promise.resolve() })
      }
      running += 1
      peak = Math.max(peak, running)
      const result = new Promise<DriverResult>((resolve) => {
        setTimeout(() => { running -= 1; resolve(completed()) }, 20)
      })
      return Promise.resolve({
        result,
        dispose: () => { running -= 1; return Promise.resolve() },
      })
    }

    const record = await engine.submit({ task: 'parallel work', cwd: repo })
    await settle(engine, record.id)

    expect(peak).toBe(2)
    const final = persisted.at(-1)!
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(final.nodes.find((n) => n.id === id)?.status).toBe('done')
    }
  })

  it('honours dependencies: aggregate waits for workers and sees their outputs', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver } = await engineDeps()
    const engine = new OrchestratorEngine(deps)

    const order: string[] = []
    const original = driver.start.bind(driver)
    driver.start = (req) => {
      order.push(req.label.split('/').pop()!)
      return original(req)
    }

    driver.script('plan', [plan([
      { id: 'a', title: 'A', prompt: 'pa' },
      { id: 'b', title: 'B', prompt: 'pb' },
      { id: 'agg', title: 'Aggregate', prompt: 'combine', kind: 'aggregate', deps: ['a', 'b'] },
    ])])
    driver.script('a', [completed('result-a')])
    driver.script('b', [completed('result-b')])
    driver.script('__validate__', [verdict()])

    const record = await engine.submit({ task: 'hierarchical', cwd: repo })
    await settle(engine, record.id)

    const aggReq = driver.requests.find((r) => r.label.endsWith('/agg'))!
    expect(aggReq.prompt).toContain('result-a')
    expect(aggReq.prompt).toContain('result-b')
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('agg'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('agg'))
    expect(order.indexOf('agg')).toBeLessThan(order.indexOf('__validate__'))
  })

  it('retries a failing node then marks dependents skipped and the run failed', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver, persisted } = await engineDeps({ maxAttempts: 2 })
    const engine = new OrchestratorEngine(deps)

    driver.script('plan', [plan([
      { id: 'a', title: 'A', prompt: 'pa' },
      { id: 'b', title: 'B', prompt: 'pb', deps: ['a'] },
      { id: 'c', title: 'C', prompt: 'pc' },
    ])])
    driver.script('a', [
      { output: '', stopReason: 'error', diagnostic: 'boom-1', retryable: true },
      { output: '', stopReason: 'error', diagnostic: 'boom-2', retryable: true },
    ])
    driver.script('__validate__', [verdict({ output: 'fail', structured: { verdict: 'fail', summary: 'a failed', issues: ['a'] }, stopReason: 'completed', retryable: false })])

    const record = await engine.submit({ task: 'x', cwd: repo })
    await settle(engine, record.id)

    expect(driver.requests.filter((r) => r.label.endsWith('/a')).length).toBe(2)
    const final = persisted.at(-1)!
    expect(final.status).toBe('failed')
    expect(final.nodes.find((n) => n.id === 'a')?.status).toBe('failed')
    expect(final.nodes.find((n) => n.id === 'b')?.status).toBe('skipped')
    expect(final.nodes.find((n) => n.id === 'c')?.status).toBe('done')
    expect(final.error).toContain('a')
  })

  it('cancels a run mid-flight', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver, persisted } = await engineDeps()
    const engine = new OrchestratorEngine(deps)

    driver.script('plan', [plan([{ id: 'a', title: 'A', prompt: 'pa' }])])
    const original = driver.start.bind(driver)
    let releaseA: (r: DriverResult) => void = () => {}
    driver.start = (req) => {
      if (req.label.endsWith('/a')) {
        driver.requests.push(req)
        return Promise.resolve({
          result: new Promise<DriverResult>((resolve) => { releaseA = resolve }),
          dispose: () => { releaseA({ output: '', stopReason: 'aborted', retryable: false }); return Promise.resolve() },
        })
      }
      return original(req)
    }

    const record = await engine.submit({ task: 'cancel me', cwd: repo })
    await untilRequest(driver, 'a')
    const cancelDone = engine.cancel(record.id)
    await cancelDone
    await settle(engine, record.id)
    const final = persisted.at(-1)!
    expect(final.status).toBe('cancelled')
  })

  it('produces a proposal from worktree edits and applies only the reviewed hash', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver, persisted } = await engineDeps()
    const engine = new OrchestratorEngine(deps)

    driver.script('plan', [plan([{ id: 'w', title: 'W', prompt: 'write file' }])])
    driver.script('__validate__', [verdict()])
    // The mock worker performs a real edit inside the run worktree.
    const original = driver.start.bind(driver)
    driver.start = (req) => {
      if (req.label.endsWith('/w')) {
        const runId = req.label.split('/')[0]!
        const worktree = join(deps.worktreeRoot, runId)
        return Promise.resolve({
          result: writeFile(join(worktree, 'hello.ts'), 'export const hi = 1\n')
            .then(() => completed('wrote hello.ts')),
          dispose: () => Promise.resolve(),
        })
      }
      return original(req)
    }

    const record = await engine.submit({ task: 'write file', cwd: repo })
    await settle(engine, record.id)

    const ready = persisted.at(-1)!
    expect(ready.status).toBe('awaiting-approval')
    expect(ready.proposal).not.toBeNull()
    expect(ready.proposal!.diff).toContain('hello.ts')
    expect(ready.proposal!.hash).toMatch(/^[0-9a-f]{64}$/)

    // Wrong hash → rejected before touching the repo.
    await expect(engine.apply(record.id, '0'.repeat(64), ready)).rejects.toThrow('hash mismatch')

    // Reviewed hash → applies; the file lands in the target repo.
    await engine.apply(record.id, ready.proposal!.hash, ready)
    const applied = await readFile(join(repo, 'hello.ts'), 'utf8')
    expect(applied).toBe('export const hi = 1\n')
  })

  it('rejects apply when the target HEAD moved after review', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver, persisted } = await engineDeps()
    const engine = new OrchestratorEngine(deps)

    driver.script('plan', [plan([{ id: 'w', title: 'W', prompt: 'x' }])])
    driver.script('__validate__', [verdict()])
    const original = driver.start.bind(driver)
    driver.start = (req) => {
      if (req.label.endsWith('/w')) {
        const worktree = join(deps.worktreeRoot, req.label.split('/')[0]!)
        return Promise.resolve({
          result: writeFile(join(worktree, 'change.md'), 'change\n').then(() => completed('ok')),
          dispose: () => Promise.resolve(),
        })
      }
      return original(req)
    }

    const record = await engine.submit({ task: 'x', cwd: repo })
    await settle(engine, record.id)
    const ready = persisted.at(-1)!
    expect(ready.status).toBe('awaiting-approval')

    // Move the target HEAD — the reviewed base is now stale.
    await writeFile(join(repo, 'later.md'), 'later\n')
    const { git } = await import('../src/git.ts')
    await git(subprocess, repo, ['add', '-A'])
    await git(subprocess, repo, ['commit', '-m', 'later'])

    await expect(engine.apply(record.id, ready.proposal!.hash, ready)).rejects.toThrow('HEAD moved')
  })

  it('rejects apply when the worktree changed after review', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const { deps, driver, persisted } = await engineDeps()
    const engine = new OrchestratorEngine(deps)

    driver.script('plan', [plan([{ id: 'w', title: 'W', prompt: 'x' }])])
    driver.script('__validate__', [verdict()])
    const original = driver.start.bind(driver)
    driver.start = (req) => {
      if (req.label.endsWith('/w')) {
        const worktree = join(deps.worktreeRoot, req.label.split('/')[0]!)
        return Promise.resolve({
          result: writeFile(join(worktree, 'change.md'), 'change\n').then(() => completed('ok')),
          dispose: () => Promise.resolve(),
        })
      }
      return original(req)
    }

    const record = await engine.submit({ task: 'x', cwd: repo })
    await settle(engine, record.id)
    const ready = persisted.at(-1)!
    expect(ready.status).toBe('awaiting-approval')

    // Tamper with the worktree after the user reviewed the diff.
    await writeFile(join(deps.worktreeRoot, record.id, 'evil.sh'), 'rm -rf ~\n')

    await expect(engine.apply(record.id, ready.proposal!.hash, ready))
      .rejects.toThrow('changed since review')
  })
})
