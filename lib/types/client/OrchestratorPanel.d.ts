import type { OrchestratorRunView } from 'dsh-orchestrator/types';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
/** One observable bound into a framework selector hook by the renderer. */
interface ObservableSnapshot<T> {
    /** Read the current value. */
    getSnapshot(): T;
    /**
     * Subscribe a change listener.
     * @param listener - notified after each publish.
     * @returns unsubscribe disposer.
     */
    subscribe(listener: () => void): () => void;
}
/** Registration-side business face for the orchestration panel. */
export interface OrchestratorInjected {
    /** Reactive sources the framework binds as selector hooks. */
    hooks: {
        /** All runs, newest first; `undefined` until the first stream frame lands. */
        runs: ObservableSnapshot<readonly OrchestratorRunView[] | undefined>;
    };
    /**
     * Submit a new orchestration task.
     * @param input - task text, absolute repository path, planner mode.
     * @returns resolves after the Host accepted the run.
     */
    submit: (input: {
        task: string;
        cwd: string;
    }) => Promise<void>;
    /**
     * Cancel a live run.
     * @param runId - run to cancel.
     */
    cancel: (runId: string) => Promise<void>;
    /**
     * Apply a reviewed proposal. The Host recomputes the worktree diff and
     * rejects a hash that no longer matches.
     * @param runId - run holding the proposal.
     * @param hash - the `proposal.hash` shown in the panel.
     */
    apply: (runId: string, hash: string) => Promise<void>;
    /**
     * Discard a proposal and remove its worktree.
     * @param runId - run to clean up.
     */
    discard: (runId: string) => Promise<void>;
}
/** Full props for the sidebar footer orchestration action. */
export type OrchestratorPanelProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS> & InjectFace<OrchestratorInjected>;
/**
 * Footer action rendering the orchestration panel. The badge shows only when
 * the Host namespace is present; the stream failure path publishes nothing,
 * so a Host without the controller keeps the feature invisible.
 */
export declare function OrchestratorPanel({ wide, useRuns, submit, cancel, apply, discard, t }: OrchestratorPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=OrchestratorPanel.d.ts.map