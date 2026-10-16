/**
 * Durable run records for the orchestrator domain. The stored record is the
 * wire view plus host-private fields needed for recovery; the Remote surface
 * projects only {@link OrchestratorRunView}.
 * @module dsh-orchestrator/domain
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
const routeSchema = z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    reasoningEffort: z.string().optional(),
});
const nodeSchema = z.object({
    id: z.string(),
    title: z.string(),
    parentId: z.string().nullable(),
    deps: z.array(z.string()),
    role: z.enum(['worker', 'aggregate', 'validator']),
    route: routeSchema,
    status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
    attempts: z.number(),
    output: z.string().nullable(),
    error: z.string().nullable(),
});
const proposalSchema = z.object({
    hash: z.string(),
    baseRev: z.string(),
    stat: z.string(),
    diff: z.string(),
});
const validationSchema = z.object({
    verdict: z.enum(['pass', 'fail']),
    summary: z.string(),
    issues: z.array(z.string()),
});
export const orchestratorRunSchema = z.object({
    id: z.string(),
    task: z.string(),
    cwd: z.string(),
    status: z.enum(['planning', 'running', 'awaiting-approval', 'applied', 'done', 'failed', 'cancelled', 'interrupted', 'discarded']),
    createdAt: z.number(),
    updatedAt: z.number(),
    worktree: z.string().nullable(),
    nodes: z.array(nodeSchema),
    proposal: proposalSchema.nullable(),
    validation: validationSchema.nullable(),
    error: z.string().nullable(),
    rootSessionId: z.string(),
    mode: z.enum(['auto', 'parallel', 'hierarchical']),
});
/**
 * Orchestrator domain declaration — one table of runs. The record schema is
 * wider than {@link OrchestratorRunRecord} only in optional-vs-undefined
 * fields, so the boundary cast is exact-shape.
 */
export const ORCHESTRATOR_DOMAIN = defineDomain({
    name: 'orchestrator',
    version: 1,
    tables: {
        runs: domainTable(orchestratorRunSchema),
    },
});
//# sourceMappingURL=domain.js.map