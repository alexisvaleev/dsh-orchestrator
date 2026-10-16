/**
 * Test fixtures: a real-git subprocess implementation over child_process, a
 * scripted delegation driver, and a tmp-repo factory. The subprocess shim
 * implements only the slice of SubprocessRuntime the engine uses.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SubprocessRuntime, SubprocessSpawnSpec, SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { DriverRequest, DriverResult, OrchestratorDriver, DriverRun } from '../src/driver.ts'
import type { EngineDeps } from '../src/engine.ts'
import type { OrchestratorRunRecord } from '../src/domain.ts'

/** Minimal collected-stream reader compatible with `handle.collected.*`. */
function collectReader(): { text: string; readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean } } {
  const state = { text: '' }
  return {
    get text() { return state.text },
    set text(v: string) { state.text = v },
    readFrom(offset: number) {
      return { text: state.text.slice(offset), nextOffset: state.text.length, lossy: false }
    },
  }
}

/** Run git/processes through real child_process for git integration tests. */
export function localSubprocess(): SubprocessRuntime {
  const runtime = {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const stdout = collectReader()
      const stderr = collectReader()
      const child = spawn(spec.argv[0]!, [...spec.argv.slice(1)], {
        cwd: spec.cwd,
        env: { ...process.env, ...(spec.env ?? {}) },
        stdio: [spec.stdio.stdin === 'ignore' ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
      child.stdout?.on('data', (chunk: Buffer) => { stdout.text += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk: Buffer) => { stderr.text += chunk.toString('utf8') })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
      })
      const stdinSpec = spec.stdio.stdin
      if (typeof stdinSpec === 'object' && 'data' in stdinSpec) {
        child.stdin!.write(stdinSpec.data)
        child.stdin!.end()
      } else if (spec.stdio.stdin === 'pipe') {
        // Tests never write to piped stdin; close it so children don't wait.
        child.stdin!.end()
      }
      spec.signal?.addEventListener('abort', () => { child.kill('SIGTERM') }, { once: true })
      const handle: SubprocessHandle = {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: { stdout, stderr },
        done,
        terminate: () => { child.kill('SIGTERM') },
        waitForExit: async () => { await done; return true },
      } as SubprocessHandle
      return handle
    },
    spawnTerminal: () => { throw new Error('not implemented') },
    provide(): void {},
  } as unknown as SubprocessRuntime
  return runtime
}

/** Scripted delegation: maps a label suffix (node id) to results in order. */
export class MockDriver implements OrchestratorDriver {
  readonly requests: DriverRequest[] = []
  private readonly scripts = new Map<string, DriverResult[]>()
  private readonly pending = new Map<string, { reject: (e: Error) => void }[]>()

  /** Queue results for labels ending in `/<suffix>`; consumed per attempt. */
  script(suffix: string, results: readonly DriverResult[]): void {
    this.scripts.set(suffix, [...results])
  }

  start(request: DriverRequest): Promise<DriverRun> {
    this.requests.push(request)
    const suffix = request.label.split('/').pop()!
    const queued = this.scripts.get(suffix)
    const result = queued !== undefined && queued.length > 0
      ? queued.shift()!
      : { output: `output of ${suffix}`, stopReason: 'completed', retryable: false }
    return Promise.resolve({
      result: Promise.resolve(result),
      dispose: () => Promise.resolve(),
    })
  }
}

/** Fake Agent sufficient for engine/driver plumbing. */
export function fakeAgent(id: string): Agent {
  return {
    id,
    session: { header: { id, cwd: '/tmp' } },
  } as unknown as Agent
}

/** Engine agent-factory stub returning fake handles. */
export function fakeAgents(): { created: string[]; create: EngineDeps['agents']['create'] } {
  const created: string[] = []
  return {
    created,
    create: (options) => {
      created.push(String(options.sessionId))
      const handle: AgentHandle = {
        agent: fakeAgent(String(options.sessionId)),
        dispose: () => Promise.resolve(),
      }
      return Promise.resolve(handle)
    },
  }
}

/** Create a tmp git repo with one committed file; returns its path. */
export async function tmpRepo(subprocess: SubprocessRuntime): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orch-repo-'))
  const { git } = await import('../src/git.ts')
  await git(subprocess, dir, ['init'])
  await git(subprocess, dir, ['config', 'user.email', 'test@test'])
  await git(subprocess, dir, ['config', 'user.name', 'test'])
  await writeFile(join(dir, 'README.md'), '# test repo\n')
  await git(subprocess, dir, ['add', '-A'])
  await git(subprocess, dir, ['commit', '-m', 'init'])
  return dir
}

/** Engine deps wired to mocks + a real tmp worktree root. */
export async function engineDeps(overrides: Partial<EngineDeps> = {}): Promise<{
  deps: EngineDeps
  driver: MockDriver
  subprocess: SubprocessRuntime
  persisted: OrchestratorRunRecord[]
}> {
  const subprocess = localSubprocess()
  const driver = new MockDriver()
  const persisted: OrchestratorRunRecord[] = []
  const worktreeRoot = await mkdtemp(join(tmpdir(), 'orch-wt-'))
  const deps: EngineDeps = {
    driver,
    agents: { create: fakeAgents().create },
    subprocess,
    persist: async (record) => { persisted.push({ ...record }) },
    worktreeRoot,
    maxConcurrency: 3,
    maxNodes: 8,
    maxAttempts: 1,
    nodeTimeoutMs: 30_000,
    toolDeny: ['orchestrate'],
    routes: { planner: {}, worker: {}, validator: {} },
    catalog: async () => [{ provider: 'mock', models: ['mock-1', 'mock-2'] }],
    ...overrides,
  }
  return { deps, driver, subprocess, persisted }
}

export { mkdir }
