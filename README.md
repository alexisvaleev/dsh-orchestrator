# dsh-orchestrator

Multi-agent orchestration plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Give it one complex task; the plugin decomposes it into a task DAG, delegates
nodes to isolated sub-agent sessions, runs independent work in parallel,
validates the combined result, and proposes a unified diff that is applied to
your repository only after you review and approve it.

## What it does

1. **Plan** — a planner sub-agent reads your task and emits a structured DAG of
   subtasks (`id`, `title`, `prompt`, `deps`, optional per-node model `route`).
2. **Work** — worker sub-agents run inside a dedicated **git worktree** created
   for the run, in parallel up to `maxConcurrency`, honouring `deps` order,
   `maxAttempts` retries, `nodeTimeoutMs`, and `maxDepth` hierarchy limits.
3. **Validate** — a validator sub-agent gets the task, every node's output, and
   the collected diff, and returns a structured `pass`/`fail` verdict. A
   validator that answers without a verdict counts as a failure.
4. **Propose** — the run's diff is hashed (SHA-256, bound to the recorded base
   revision) and presented in the sidebar panel. **Nothing touches your working
   tree until you press Apply.**
5. **Apply** — Apply re-computes the diff and refuses a changed hash or a moved
   target `HEAD`, then `git apply`s the reviewed proposal only.

Runs are durable (`storageDomain`): a Host restart mid-run marks the run
`interrupted`, removes its worktree, and keeps it visible in the panel.

## Packages

| Package | Role |
| --- | --- |
| `dsh-orchestrator-controller` | Host plugin: engine, planner/worker/validator delegation, git worktree plumbing, `orchestrator` Remote namespace, `orchestrate` agent tool. |
| `dsh-ui-orchestrator` | Client plugin: sidebar-footer badge + panel (submit form, run tree, validation verdict, diff review, Apply/Discard). |
| `dsh-orchestrator` | Installable bundle composing both via `cordis.patch.yml`. |

## Install

From the bundle directory inside this repo (the layout
[`dsh-devin-limits`](https://github.com/alexisvaleev/dsh-devin-limits)
established):

```sh
pnpm dsh web --patch /path/to/dsh-orchestrator/packages/dsh-orchestrator/cordis.patch.yml
```

or list `dsh-orchestrator` in your profile's `cordis.yml` overlays. The patch
needs the workspace packages on the resolver path — keep this repo beside your
Harness checkout or publish the packages and pin their versions.

## Configuration

`dsh-orchestrator-controller` config keys (defaults in parentheses):

| Key | Meaning |
| --- | --- |
| `subagentProvider` (`'spawn'`) | Delegation provider name; `spawn` starts fresh-context children, `fork` inherits completed parent history. |
| `routeProviders` (`[]`) | Provider routes the planner may route roles/nodes through, e.g. `["devin", "deepseek-official"]`. Empty → children inherit the session route. |
| `plannerRoute` / `workerRoute` / `validatorRoute` | Optional `{ provider, model, reasoningEffort }` defaults per role. |
| `maxConcurrency` (`3`) | Max delegated nodes running at once (capped at 8). |
| `maxNodes` (`8`) | Planner task-count cap (≤16). |
| `maxAttempts` (`2`) | Attempts per node, including the first. |
| `nodeTimeoutMs` (`900000`) | Per-node wall-clock timeout. |
| `maxDepth` (`0`) | Delegation depth cap passed to the subagent runtime (0 = provider default). |
| `worktreeRoot` | Directory run worktrees are created under (default `$DSH_HOME/orchestrator` or `~/.dsh/orchestrator`). |
| `toolDeny` (`["orchestrate"]`) | Tool names denied to every delegated node — prevents nested orchestration by default. |

`cordis.patch.yml` already exposes `DSH_ORCHESTRATOR_PROVIDERS=a,b` as a
comma-separated shortcut for `routeProviders`.

## Usage

- **Panel**: click the Orchestrate entry in the sidebar footer, fill in the
  task and the repository's absolute path, start the run, watch the node tree,
  review the proposed diff, then Apply (checkbox-gated) or Discard.
- **Tool**: the `orchestrate` tool is visible to agents — ask the assistant to
  "orchestrate" a complex change; the tool call starts a run whose approval
  still lives in the panel.
- **Routes**: `submit`'s `routes` and plan node `route` fields must name
  providers from `routeProviders` and models from `ctx.llm.listModels(provider)`;
  unknown routes fail the submit loudly.

## Safety model

- Secrets never cross the Remote boundary: the wire carries task text, node
  status/output/error, and the proposal diff — nothing else.
- Children run only inside the run worktree; the target repository is read-only
  until Apply.
- Apply is hash-bound: `sha256(diff)` must equal the reviewed proposal
  and the target `HEAD` must still equal the recorded base.
- `git` invocations use explicit `argv` arrays through `ctx.subprocess` —
  no shell interpretation anywhere.

## Development

```sh
pnpm install
pnpm -r build     # tsc + tsdown + typert artifact emit
pnpm -r test      # vitest — unit, engine, git, and real-Context composition
```

The Typert Remote artifacts (`lib/typert.host.js`, `lib/typert.remote-client.js`)
are emitted by `packages/orchestrator-controller/scripts/emit-typert.mjs`
because the upstream generator requires the Harness monorepo workspace. The
emitter's zod schemas mirror `src/types.ts` — keep them in sync.
