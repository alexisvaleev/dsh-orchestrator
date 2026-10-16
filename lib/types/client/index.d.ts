/**
 * Client half of the orchestration feature: registers the `orchestrator`
 * dictionaries, feeds the `orchestrator/watch` Remote stream into a run-list
 * store, and registers the sidebar-footer panel with submit/cancel/apply/
 * discard controls. A Host without the controller rejects the watch; the
 * badge then shows a quiet glyph and an empty panel.
 * @module dsh-orchestrator/client
 */
import { Context } from '@deepseek-ai/cordis';
import { type OrchestratorKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Orchestration panel copy. */
        'orchestrator': OrchestratorKey;
    }
}
export type { OrchestratorInjected, OrchestratorPanelProps } from './OrchestratorPanel.tsx';
/** Required services: slot registry, dictionaries, and the Remote carrier. */
export declare const inject: string[];
/**
 * @param ctx - Client plugin context: locale, slots, Remote namespaces.
 */
export declare function apply(ctx: Context): Promise<void>;
//# sourceMappingURL=index.d.ts.map