/**
 * Durable run records for the orchestrator domain. The stored record is the
 * wire view plus host-private fields needed for recovery; the Remote surface
 * projects only {@link OrchestratorRunView}.
 * @module dsh-orchestrator/domain
 */
import { z } from 'zod';
import type { OrchestratorRunView } from './types.ts';
/** One persisted run: the public view plus recovery fields. */
export interface OrchestratorRunRecord extends OrchestratorRunView {
    /** Session id of the run's root orchestrator agent, for lineage lookup. */
    readonly rootSessionId: string;
    /** Planner strategy actually requested (`auto` resolved stays `auto`). */
    readonly mode: 'auto' | 'parallel' | 'hierarchical';
}
export declare const orchestratorRunSchema: z.ZodObject<{
    id: z.ZodString;
    task: z.ZodString;
    cwd: z.ZodString;
    status: z.ZodEnum<{
        running: "running";
        done: "done";
        failed: "failed";
        planning: "planning";
        "awaiting-approval": "awaiting-approval";
        applied: "applied";
        cancelled: "cancelled";
        interrupted: "interrupted";
        discarded: "discarded";
    }>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
    worktree: z.ZodNullable<z.ZodString>;
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        parentId: z.ZodNullable<z.ZodString>;
        deps: z.ZodArray<z.ZodString>;
        role: z.ZodEnum<{
            worker: "worker";
            aggregate: "aggregate";
            validator: "validator";
        }>;
        route: z.ZodObject<{
            provider: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        status: z.ZodEnum<{
            pending: "pending";
            running: "running";
            done: "done";
            failed: "failed";
            skipped: "skipped";
        }>;
        attempts: z.ZodNumber;
        output: z.ZodNullable<z.ZodString>;
        error: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    proposal: z.ZodNullable<z.ZodObject<{
        hash: z.ZodString;
        baseRev: z.ZodString;
        stat: z.ZodString;
        diff: z.ZodString;
    }, z.core.$strip>>;
    validation: z.ZodNullable<z.ZodObject<{
        verdict: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
        }>;
        summary: z.ZodString;
        issues: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    error: z.ZodNullable<z.ZodString>;
    rootSessionId: z.ZodString;
    mode: z.ZodEnum<{
        auto: "auto";
        parallel: "parallel";
        hierarchical: "hierarchical";
    }>;
}, z.core.$strip>;
/**
 * Orchestrator domain declaration — one table of runs. The record schema is
 * wider than {@link OrchestratorRunRecord} only in optional-vs-undefined
 * fields, so the boundary cast is exact-shape.
 */
export declare const ORCHESTRATOR_DOMAIN: {
    name: string;
    version: number;
    tables: {
        runs: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, OrchestratorRunRecord>;
    };
};
//# sourceMappingURL=domain.d.ts.map