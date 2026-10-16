/**
 * Git plumbing for run isolation. Every invocation goes through the Host's
 * `ctx.subprocess` seam (no shell, scrubbed environment) against an explicit
 * `cwd`; nothing in this module mutates the user's workspace except
 * {@link applyDiff}, which the engine reaches only after hash-bound approval.
 * @module dsh-orchestrator/git
 */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
/** A git invocation exited non-zero; `stderr` carries the captured diagnostic tail. */
export declare class GitError extends Error {
    readonly argv: readonly string[];
    readonly exitCode: number | null;
    readonly stderr: string;
    constructor(argv: readonly string[], exitCode: number | null, stderr: string);
}
/**
 * Run one git command inside `cwd` and return collected stdout.
 * @param subprocess - the Host subprocess service.
 * @param cwd - repository directory the command acts on.
 * @param args - argv tail after `git`.
 * @param options - optional stdin payload and cancellation.
 * @returns collected stdout text.
 */
export declare function git(subprocess: SubprocessRuntime, cwd: string, args: readonly string[], options?: {
    stdin?: string;
    signal?: AbortSignal;
}): Promise<string>;
/**
 * Cut a detached worktree for one run.
 * @returns the base commit the worktree was created from (the approval anchor).
 */
export declare function createWorktree(subprocess: SubprocessRuntime, repoCwd: string, worktreePath: string, signal?: AbortSignal): Promise<string>;
/**
 * Stage everything inside the worktree and return the reviewable proposal:
 * the full staged diff, its `--stat`, and the hash the approval binds to.
 * @returns `null` when the worktree contains no changes — nothing to review.
 */
export declare function collectDiff(subprocess: SubprocessRuntime, worktreePath: string, signal?: AbortSignal): Promise<{
    diff: string;
    stat: string;
    hash: string;
} | null>;
/**
 * Apply a previously reviewed diff into the target repository's working tree.
 * `git apply --check` guards the mutation with an atomic dry run.
 */
export declare function applyDiff(subprocess: SubprocessRuntime, repoCwd: string, diff: string, signal?: AbortSignal): Promise<void>;
/**
 * Remove a run's worktree. `--force` drops uncommitted content — callers only
 * reach this on explicit discard/apply or restart cleanup. A git refusal
 * (e.g. the path is not a registered worktree) is reported to the caller.
 */
export declare function removeWorktree(subprocess: SubprocessRuntime, repoCwd: string, worktreePath: string, signal?: AbortSignal): Promise<void>;
//# sourceMappingURL=git.d.ts.map