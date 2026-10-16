/**
 * Git plumbing for run isolation. Every invocation goes through the Host's
 * `ctx.subprocess` seam (no shell, scrubbed environment) against an explicit
 * `cwd`; nothing in this module mutates the user's workspace except
 * {@link applyDiff}, which the engine reaches only after hash-bound approval.
 * @module dsh-orchestrator/git
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
/** Cap on retained stdout/stderr per git invocation. */
const GIT_COLLECT_BYTES = 8 * 1024 * 1024;
/** Termination grace handed to the subprocess provider. */
const GIT_GRACE_MS = 5_000;
/** A git invocation exited non-zero; `stderr` carries the captured diagnostic tail. */
export class GitError extends Error {
    argv;
    exitCode;
    stderr;
    constructor(argv, exitCode, stderr) {
        super(`git ${argv.join(' ')} exited with ${exitCode ?? 'signal'}: ${stderr.trim() || 'no stderr'}`);
        this.argv = argv;
        this.exitCode = exitCode;
        this.stderr = stderr;
        this.name = 'GitError';
    }
}
/**
 * Run one git command inside `cwd` and return collected stdout.
 * @param subprocess - the Host subprocess service.
 * @param cwd - repository directory the command acts on.
 * @param args - argv tail after `git`.
 * @param options - optional stdin payload and cancellation.
 * @returns collected stdout text.
 */
export async function git(subprocess, cwd, args, options = {}) {
    const handle = subprocess.spawn({
        argv: ['git', ...args],
        cwd,
        stdio: {
            stdin: options.stdin !== undefined ? { data: options.stdin } : 'ignore',
            stdout: { maxBytes: GIT_COLLECT_BYTES },
            stderr: { maxBytes: GIT_COLLECT_BYTES },
        },
        graceMs: GIT_GRACE_MS,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    const outcome = await handle.done;
    const stdoutRead = handle.collected.stdout?.readFrom(0);
    if (stdoutRead?.lossy) {
        if (stdoutRead.spillPath === undefined) {
            throw new GitError(['git', ...args], outcome.exitCode ?? null, 'stdout exceeded the retained window');
        }
        const stdout = await readFile(stdoutRead.spillPath, 'utf8');
        if (outcome.exitCode !== 0) {
            const stderr = handle.collected.stderr?.readFrom(0).text ?? '';
            throw new GitError(['git', ...args], outcome.exitCode ?? null, stderr);
        }
        return stdout;
    }
    const stdout = stdoutRead?.text ?? '';
    const stderr = handle.collected.stderr?.readFrom(0).text ?? '';
    if (outcome.exitCode !== 0) {
        throw new GitError(['git', ...args], outcome.exitCode, stderr);
    }
    return stdout;
}
/**
 * Cut a detached worktree for one run.
 * @returns the base commit the worktree was created from (the approval anchor).
 */
export async function createWorktree(subprocess, repoCwd, worktreePath, signal) {
    const baseRev = (await git(subprocess, repoCwd, ['rev-parse', 'HEAD'], { ...(signal !== undefined ? { signal } : {}) })).trim();
    await git(subprocess, repoCwd, ['worktree', 'add', '--detach', worktreePath, baseRev], { ...(signal !== undefined ? { signal } : {}) });
    return baseRev;
}
/**
 * Stage everything inside the worktree and return the reviewable proposal:
 * the full staged diff, its `--stat`, and the hash the approval binds to.
 * @returns `null` when the worktree contains no changes — nothing to review.
 */
export async function collectDiff(subprocess, worktreePath, signal) {
    const opts = signal !== undefined ? { signal } : {};
    await git(subprocess, worktreePath, ['add', '-A'], opts);
    const diff = await git(subprocess, worktreePath, ['diff', '--cached'], opts);
    if (diff.trim().length === 0)
        return null;
    const stat = await git(subprocess, worktreePath, ['diff', '--cached', '--stat'], opts);
    const hash = createHash('sha256').update(diff).digest('hex');
    return { diff, stat, hash };
}
/**
 * Apply a previously reviewed diff into the target repository's working tree.
 * `git apply --check` guards the mutation with an atomic dry run.
 */
export async function applyDiff(subprocess, repoCwd, diff, signal) {
    const opts = { stdin: diff, ...(signal !== undefined ? { signal } : {}) };
    await git(subprocess, repoCwd, ['apply', '--check', '--whitespace=nowarn', '-'], opts);
    await git(subprocess, repoCwd, ['apply', '--whitespace=nowarn', '-'], opts);
}
/**
 * Remove a run's worktree. `--force` drops uncommitted content — callers only
 * reach this on explicit discard/apply or restart cleanup. A git refusal
 * (e.g. the path is not a registered worktree) is reported to the caller.
 */
export async function removeWorktree(subprocess, repoCwd, worktreePath, signal) {
    await git(subprocess, repoCwd, ['worktree', 'remove', '--force', worktreePath], { ...(signal !== undefined ? { signal } : {}) });
}
//# sourceMappingURL=git.js.map