# dsh-orchestrator-controller

Host half of `dsh-orchestrator`: a Cordis plugin exposing the `orchestrator`
Remote namespace and the `orchestrate` agent tool.

Responsibilities:

- `src/engine.ts` — run lifecycle: planner delegation → DAG scheduler
  (deps-ordered, `maxConcurrency` workers) → validator → diff proposal.
- `src/graph.ts` — plan schema validation (ids, deps, cycles, limits) and
  ready/skipped bookkeeping.
- `src/driver.ts` — the delegation seam (`WorkerDriver` iface) and the
  subagent-backed implementation over `ctx.subagents`.
- `src/git.ts` — `argv`-only git plumbing over `ctx.subprocess`: detached
  worktree creation, staged-diff collection, hash-bound `git apply`.
- `src/domain.ts` — the `orchestrator` storage domain (durable run records).
- `src/prompts.ts` — planner/validator prompt and JSON-schema construction.
- `src/index.ts` — `OrchestratorController` service, `Config`, Remote methods,
  restart recovery, and the `orchestrate` tool.

`lib/typert.*` artifacts are emitted by `scripts/emit-typert.mjs` — the
upstream generator runs only inside the Harness monorepo workspace, so this
package ships an equivalent declarative emitter. Keep its zod schemas in sync
with `src/types.ts`.
