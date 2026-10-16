/**
 * Wire-facing types of the `orchestrator` Remote namespace. Everything here is
 * a redacted projection: it must stay free of secrets, raw tool payloads, and
 * host-internal object identities.
 * @module dsh-orchestrator-controller/types
 */

/**
 * One model route requested for an orchestration role or node. Fields left
 * undefined inherit the parent session's current route.
 */
export interface OrchestratorModelRoute {
  /** Llm adapter route name, e.g. `devin`, `deepseek-official`. */
  readonly provider?: string
  /** Model id within the provider catalog, e.g. `devin-llm/swe-2`. */
  readonly model?: string
  /** Reasoning effort id declared by the provider catalog. */
  readonly reasoningEffort?: string
}

/** Per-role route overrides accepted by {@link OrchestratorSubmitInput}. */
export interface OrchestratorRouteOverrides {
  readonly planner?: OrchestratorModelRoute
  readonly worker?: OrchestratorModelRoute
  readonly validator?: OrchestratorModelRoute
}

/** Decomposition strategy asked of the planner. */
export type OrchestratorMode = 'auto' | 'parallel' | 'hierarchical'

/** A new orchestration run request. */
export interface OrchestratorSubmitInput {
  /** The complex development task, in the user's own words. */
  readonly task: string
  /** Absolute path of the git worktree's source repository — never modified before approval. */
  readonly cwd: string
  /** Planner strategy hint; `auto` lets the planner pick. Defaults to `auto`. */
  readonly mode?: OrchestratorMode
  /** Optional role-level route overrides; node-level routes from the plan win over `worker`. */
  readonly routes?: OrchestratorRouteOverrides
}

/** Lifecycle states of one plan node. */
export type OrchestratorNodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** Durable lifecycle states of one orchestration run. */
export type OrchestratorRunStatus =
  | 'planning'
  | 'running'
  | 'awaiting-approval'
  | 'applied'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'discarded'

/** One node's public state. */
export interface OrchestratorNodeView {
  readonly id: string
  readonly title: string
  /** Parent node id for aggregate (hierarchical reduce) nodes, else null. */
  readonly parentId: string | null
  /** Node ids that must reach `done` before this node may start. */
  readonly deps: readonly string[]
  readonly role: 'worker' | 'aggregate' | 'validator'
  /** Effective model route this node was dispatched with. */
  readonly route: OrchestratorModelRoute
  readonly status: OrchestratorNodeStatus
  /** Execution attempts consumed, including the in-flight one. */
  readonly attempts: number
  /** Final assistant text of the last successful attempt, if any. */
  readonly output: string | null
  /** Failure detail of the last failed attempt, if any. */
  readonly error: string | null
}

/** The reviewable change set prepared inside the run's isolated worktree. */
export interface OrchestratorProposal {
  /** SHA-256 of `diff`; the exact approval identity. */
  readonly hash: string
  /** Base commit the worktree was cut from; applying requires it to still be the target HEAD. */
  readonly baseRev: string
  /** `git diff --stat` output for display. */
  readonly stat: string
  /** Full unified diff text. */
  readonly diff: string
}

/** Validator verdict recorded before the proposal stage. */
export interface OrchestratorValidation {
  readonly verdict: 'pass' | 'fail'
  readonly summary: string
  readonly issues: readonly string[]
}

/** The public, durable view of one orchestration run. */
export interface OrchestratorRunView {
  readonly id: string
  readonly task: string
  readonly cwd: string
  readonly status: OrchestratorRunStatus
  readonly createdAt: number
  readonly updatedAt: number
  /** Absolute path of the run's isolated worktree, while it exists. */
  readonly worktree: string | null
  readonly nodes: readonly OrchestratorNodeView[]
  readonly proposal: OrchestratorProposal | null
  readonly validation: OrchestratorValidation | null
  /** Run-level failure detail once `status` is `failed`, `cancelled`, or `interrupted`. */
  readonly error: string | null
}

/** Provider route plus its catalog models, for the route picker. */
export interface OrchestratorRouteCatalog {
  readonly provider: string
  readonly models: readonly { readonly id: string; readonly name: string | null }[]
}
