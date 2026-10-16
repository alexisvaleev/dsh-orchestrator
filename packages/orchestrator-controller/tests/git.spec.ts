import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyDiff, collectDiff, createWorktree, git, removeWorktree } from '../src/git.ts'
import { localSubprocess, tmpRepo } from './fixtures.ts'

describe('git plumbing', () => {
  it('creates a detached worktree at HEAD', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const wt = join(await mkdtemp(join(tmpdir(), 'orch-wt-')), 'wt')
    const baseRev = await createWorktree(subprocess, repo, wt)
    const head = (await git(subprocess, repo, ['rev-parse', 'HEAD'])).trim()
    expect(baseRev).toBe(head)
    expect(await readFile(join(wt, 'README.md'), 'utf8')).toContain('test repo')
    await removeWorktree(subprocess, repo, wt)
  })

  it('collects the staged diff including new files, with a stable hash', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const wt = join(await mkdtemp(join(tmpdir(), 'orch-wt-')), 'wt')
    await createWorktree(subprocess, repo, wt)

    expect(await collectDiff(subprocess, wt)).toBeNull()

    await writeFile(join(wt, 'new.ts'), 'export {}\n')
    const first = await collectDiff(subprocess, wt)
    expect(first).not.toBeNull()
    expect(first!.diff).toContain('new.ts')
    expect(first!.stat).toContain('new.ts')
    expect(first!.hash).toMatch(/^[0-9a-f]{64}$/)

    await applyDiff(subprocess, repo, first!.diff)
    expect(await readFile(join(repo, 'new.ts'), 'utf8')).toBe('export {}\n')
    await removeWorktree(subprocess, repo, wt)
  })

  it('fails apply when the diff no longer applies cleanly', async () => {
    const subprocess = localSubprocess()
    const repo = await tmpRepo(subprocess)
    const wt = join(await mkdtemp(join(tmpdir(), 'orch-wt-')), 'wt')
    await createWorktree(subprocess, repo, wt)

    await writeFile(join(wt, 'README.md'), '# changed in worktree\n')
    const proposal = await collectDiff(subprocess, wt)

    // Same change already committed in the target → git apply --check rejects.
    await writeFile(join(repo, 'README.md'), '# changed in worktree\n')
    await git(subprocess, repo, ['add', '-A'])
    await git(subprocess, repo, ['commit', '-m', 'same change'])

    await expect(applyDiff(subprocess, repo, proposal!.diff)).rejects.toThrow('git apply')
    await removeWorktree(subprocess, repo, wt)
  })

  it('rejects non-git directories loudly', async () => {
    const subprocess = localSubprocess()
    const plain = await mkdtemp(join(tmpdir(), 'orch-plain-'))
    await expect(createWorktree(subprocess, plain, join(plain, 'wt'))).rejects.toThrow('git')
  })
})
