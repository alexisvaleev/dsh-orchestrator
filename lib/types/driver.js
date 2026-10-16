/**
 * The provider adapter boundary. The engine talks to {@link OrchestratorDriver}
 * only; {@link SubagentDriver} adapts the native `ctx.subagents` seam, and
 * tests substitute a scripted driver. No provider-specific logic may appear
 * outside this module.
 * @module dsh-orchestrator/driver
 */
/** `stopReason` values worth a retry under the configured attempt limit. */
const RETRYABLE_STOP_REASONS = new Set(['error', 'max-tokens']);
/** Flatten content blocks into display text for node outputs. */
export function contentText(blocks) {
    const parts = [];
    for (const block of blocks) {
        if (block.type === 'text')
            parts.push(block.text);
    }
    return parts.join('');
}
/**
 * Driver over the native `ctx.subagents` seam. One provider name covers every
 * node; per-node model routes ride `agentOptions`, which in-process providers
 * merge over the parent's current route.
 */
export class SubagentDriver {
    subagents;
    providerName;
    maxDepth;
    /**
     * @param subagents - the Host's subagent runtime.
     * @param providerName - registered provider name (`spawn` ships with the base bundle).
     * @param maxDepth - delegation depth forwarded to every node.
     */
    constructor(subagents, providerName, maxDepth) {
        this.subagents = subagents;
        this.providerName = providerName;
        this.maxDepth = maxDepth;
    }
    async start(request) {
        const agentOptions = {};
        if (request.route.provider !== undefined)
            agentOptions.provider = request.route.provider;
        if (request.route.model !== undefined)
            agentOptions.model = request.route.model;
        if (request.route.reasoningEffort !== undefined) {
            agentOptions.reasoningEffort = request.route.reasoningEffort;
        }
        const run = await this.subagents.start(this.providerName, {
            label: request.label,
            prompt: [{ type: 'text', text: request.prompt }],
            parent: request.parent,
            signal: request.signal,
            agentOptions,
            ...(request.outputSchema !== undefined ? { outputSchema: request.outputSchema } : {}),
            ...(request.toolFilter !== undefined ? { toolFilter: request.toolFilter } : {}),
            ...(request.persona !== undefined ? { persona: request.persona } : {}),
            ...(this.maxDepth !== undefined ? { maxDepth: this.maxDepth } : {}),
        });
        return {
            result: run.result.then((result) => ({
                output: contentText(result.output),
                ...(result.structured !== undefined ? { structured: result.structured } : {}),
                stopReason: result.stopReason,
                ...(result.diagnostic !== undefined ? { diagnostic: result.diagnostic } : {}),
                retryable: RETRYABLE_STOP_REASONS.has(result.stopReason),
            })),
            dispose: () => run.dispose(),
        };
    }
}
//# sourceMappingURL=driver.js.map