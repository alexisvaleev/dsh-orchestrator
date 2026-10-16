import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { mkdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { brandString } from "@deepseek-ai/dsh-brand";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z as z$1 } from "zod";
//#region lib/types/graph.js
/**
* Plan schema and the DAG state machine the engine schedules over. The module
* is deliberately free of Cordis, subprocess, and model access so every
* scheduling invariant is unit-testable.
* @module dsh-orchestrator/graph
*/
/** Object-rooted JSON schema handed to the planner subagent as `outputSchema`. */
const PLAN_OUTPUT_SCHEMA = {
	type: "object",
	required: ["tasks"],
	additionalProperties: false,
	properties: {
		tasks: {
			type: "array",
			items: {
				type: "object",
				required: [
					"id",
					"title",
					"prompt"
				],
				additionalProperties: false,
				properties: {
					id: {
						type: "string",
						description: "Stable task id, unique inside this plan."
					},
					title: {
						type: "string",
						description: "Short human-readable task title."
					},
					prompt: {
						type: "string",
						description: "Self-contained instruction for the worker agent, including file scope and acceptance criteria."
					},
					kind: {
						enum: ["work", "aggregate"],
						description: "`aggregate` nodes run after their deps and synthesize dep outputs; `work` nodes edit the shared worktree."
					},
					deps: {
						type: "array",
						items: { type: "string" },
						description: "Ids of tasks that must complete first. Omit for independent (parallel) tasks."
					},
					route: {
						type: "object",
						additionalProperties: false,
						properties: {
							provider: { type: "string" },
							model: { type: "string" },
							reasoningEffort: { type: "string" }
						},
						description: "Model route override for this task, chosen from the supplied catalog."
					}
				}
			}
		},
		notes: {
			type: "string",
			description: "Optional planner rationale, shown to the user."
		}
	}
};
/** Structured plan is trusted data only after these invariants are re-checked in-plugin. */
var PlanError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PlanError";
	}
};
/**
* Validate and flatten planner output into the runtime graph. Rejects empty
* plans, duplicate or unknown ids, cycles, and node counts above `maxNodes`.
* @param plan - the planner's structured output.
* @param options - limits and the worker route fallback applied to plan tasks.
* @returns graph nodes keyed by task id.
*/
function buildGraph(plan, options) {
	if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new PlanError("planner returned no tasks");
	if (plan.tasks.length > options.maxNodes) throw new PlanError(`planner returned ${plan.tasks.length} tasks; the configured limit is ${options.maxNodes}`);
	const nodes = /* @__PURE__ */ new Map();
	for (const task of plan.tasks) {
		if (typeof task.id !== "string" || task.id.length === 0 || nodes.has(task.id) || RESERVED_NODE_IDS.has(task.id)) throw new PlanError(`invalid or duplicate task id: ${String(task.id)}`);
		nodes.set(task.id, {
			id: task.id,
			title: task.title,
			prompt: task.prompt,
			parentId: null,
			deps: task.deps ?? [],
			role: task.kind === "aggregate" ? "aggregate" : "worker",
			route: task.route ?? options.workerRoute,
			status: "pending",
			attempts: 0,
			output: null,
			error: null,
			waitForSettled: false
		});
	}
	for (const node of nodes.values()) {
		for (const dep of node.deps) if (!nodes.has(dep)) throw new PlanError(`task '${node.id}' depends on unknown task '${dep}'`);
		const provider = node.route.provider;
		if (provider !== void 0 && options.allowedProviders !== void 0 && !options.allowedProviders.has(provider)) throw new PlanError(`task '${node.id}' routes to provider '${provider}' outside the configured catalog`);
	}
	assertAcyclic(nodes);
	for (const node of nodes.values()) if (node.role === "aggregate") node.parentId = node.deps[0] ?? null;
	return nodes;
}
/** Reject dependency cycles before the scheduler can deadlock on them. */
function assertAcyclic(nodes) {
	const visiting = /* @__PURE__ */ new Set();
	const done = /* @__PURE__ */ new Set();
	const visit = (id) => {
		if (done.has(id)) return;
		if (visiting.has(id)) throw new PlanError(`dependency cycle involving task '${id}'`);
		visiting.add(id);
		for (const dep of nodes.get(id).deps) visit(dep);
		visiting.delete(id);
		done.add(id);
	};
	for (const id of nodes.keys()) visit(id);
}
/** Node ids the engine owns; planner output may not use them. */
const RESERVED_NODE_IDS = /* @__PURE__ */ new Set(["__validate__"]);
/** Append the engine-owned validator node depending on every plan node. */
function attachValidator(nodes, route) {
	const validator = {
		id: "__validate__",
		title: "Validate results",
		prompt: "",
		parentId: null,
		deps: [...nodes.keys()],
		role: "validator",
		route,
		status: "pending",
		attempts: 0,
		output: null,
		error: null,
		waitForSettled: true
	};
	nodes.set(validator.id, validator);
	return validator;
}
/** Nodes whose dependencies are satisfied and may start now. */
function readyNodes(nodes) {
	const ready = [];
	for (const node of nodes.values()) {
		if (node.status !== "pending") continue;
		if (node.deps.every((dep) => {
			const depNode = nodes.get(dep);
			return node.waitForSettled ? depNode.status !== "pending" && depNode.status !== "running" : depNode.status === "done";
		})) ready.push(node);
	}
	return ready;
}
/**
* Mark nodes unreachable because a hard dependency failed or was skipped.
* Returns the ids newly marked `skipped`; repeats until the cascade settles.
*/
function cascadeSkipped(nodes) {
	const skipped = [];
	let changed = true;
	while (changed) {
		changed = false;
		for (const node of nodes.values()) {
			if (node.status !== "pending" || node.waitForSettled) continue;
			if (node.deps.some((dep) => {
				const depNode = nodes.get(dep);
				return depNode.status === "failed" || depNode.status === "skipped";
			})) {
				node.status = "skipped";
				skipped.push(node.id);
				changed = true;
			}
		}
	}
	return skipped;
}
/** Whether every node reached a terminal state. */
function isSettled(nodes) {
	for (const node of nodes.values()) if (node.status === "pending" || node.status === "running") return false;
	return true;
}
/** Ids of nodes that ended `failed` — used for the run-level error summary. */
function failedNodes(nodes) {
	return [...nodes.values()].filter((node) => node.status === "failed");
}
//#endregion
//#region lib/types/git.js
/**
* Git plumbing for run isolation. Every invocation goes through the Host's
* `ctx.subprocess` seam (no shell, scrubbed environment) against an explicit
* `cwd`; nothing in this module mutates the user's workspace except
* {@link applyDiff}, which the engine reaches only after hash-bound approval.
* @module dsh-orchestrator/git
*/
/** Cap on retained stdout/stderr per git invocation. */
const GIT_COLLECT_BYTES = 8388608;
/** Termination grace handed to the subprocess provider. */
const GIT_GRACE_MS = 5e3;
/** A git invocation exited non-zero; `stderr` carries the captured diagnostic tail. */
var GitError = class extends Error {
	argv;
	exitCode;
	stderr;
	constructor(argv, exitCode, stderr) {
		super(`git ${argv.join(" ")} exited with ${exitCode ?? "signal"}: ${stderr.trim() || "no stderr"}`);
		this.argv = argv;
		this.exitCode = exitCode;
		this.stderr = stderr;
		this.name = "GitError";
	}
};
/**
* Run one git command inside `cwd` and return collected stdout.
* @param subprocess - the Host subprocess service.
* @param cwd - repository directory the command acts on.
* @param args - argv tail after `git`.
* @param options - optional stdin payload and cancellation.
* @returns collected stdout text.
*/
async function git(subprocess, cwd, args, options = {}) {
	const handle = subprocess.spawn({
		argv: ["git", ...args],
		cwd,
		stdio: {
			stdin: options.stdin !== void 0 ? { data: options.stdin } : "ignore",
			stdout: { maxBytes: GIT_COLLECT_BYTES },
			stderr: { maxBytes: GIT_COLLECT_BYTES }
		},
		graceMs: GIT_GRACE_MS,
		...options.signal !== void 0 ? { signal: options.signal } : {}
	});
	const outcome = await handle.done;
	const stdoutRead = handle.collected.stdout?.readFrom(0);
	if (stdoutRead?.lossy) {
		if (stdoutRead.spillPath === void 0) throw new GitError(["git", ...args], outcome.exitCode ?? null, "stdout exceeded the retained window");
		const stdout = await readFile(stdoutRead.spillPath, "utf8");
		if (outcome.exitCode !== 0) {
			const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
			throw new GitError(["git", ...args], outcome.exitCode ?? null, stderr);
		}
		return stdout;
	}
	const stdout = stdoutRead?.text ?? "";
	const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
	if (outcome.exitCode !== 0) throw new GitError(["git", ...args], outcome.exitCode, stderr);
	return stdout;
}
/**
* Cut a detached worktree for one run.
* @returns the base commit the worktree was created from (the approval anchor).
*/
async function createWorktree(subprocess, repoCwd, worktreePath, signal) {
	const baseRev = (await git(subprocess, repoCwd, ["rev-parse", "HEAD"], { ...signal !== void 0 ? { signal } : {} })).trim();
	await git(subprocess, repoCwd, [
		"worktree",
		"add",
		"--detach",
		worktreePath,
		baseRev
	], { ...signal !== void 0 ? { signal } : {} });
	return baseRev;
}
/**
* Stage everything inside the worktree and return the reviewable proposal:
* the full staged diff, its `--stat`, and the hash the approval binds to.
* @returns `null` when the worktree contains no changes — nothing to review.
*/
async function collectDiff(subprocess, worktreePath, signal) {
	const opts = signal !== void 0 ? { signal } : {};
	await git(subprocess, worktreePath, ["add", "-A"], opts);
	const diff = await git(subprocess, worktreePath, ["diff", "--cached"], opts);
	if (diff.trim().length === 0) return null;
	return {
		diff,
		stat: await git(subprocess, worktreePath, [
			"diff",
			"--cached",
			"--stat"
		], opts),
		hash: createHash("sha256").update(diff).digest("hex")
	};
}
/**
* Apply a previously reviewed diff into the target repository's working tree.
* `git apply --check` guards the mutation with an atomic dry run.
*/
async function applyDiff(subprocess, repoCwd, diff, signal) {
	const opts = {
		stdin: diff,
		...signal !== void 0 ? { signal } : {}
	};
	await git(subprocess, repoCwd, [
		"apply",
		"--check",
		"--whitespace=nowarn",
		"-"
	], opts);
	await git(subprocess, repoCwd, [
		"apply",
		"--whitespace=nowarn",
		"-"
	], opts);
}
/**
* Remove a run's worktree. `--force` drops uncommitted content — callers only
* reach this on explicit discard/apply or restart cleanup. A git refusal
* (e.g. the path is not a registered worktree) is reported to the caller.
*/
async function removeWorktree(subprocess, repoCwd, worktreePath, signal) {
	await git(subprocess, repoCwd, [
		"worktree",
		"remove",
		"--force",
		worktreePath
	], { ...signal !== void 0 ? { signal } : {} });
}
//#endregion
//#region lib/types/prompts.js
/**
* Prompt builders for the three orchestration roles. Each child gets a
* self-contained instruction — spawned children see no parent history.
* @module dsh-orchestrator/prompts
*/
/** Cap on dependency output text inlined into a downstream prompt. */
const DEP_OUTPUT_LIMIT = 8e3;
/**
* Build the planner instruction. The planner is read-only by convention: it
* decomposes and routes, it does not edit.
* @param task - the user's task.
* @param mode - requested strategy hint.
* @param catalog - provider routes with model ids the plan may reference.
* @param maxNodes - hard cap the planner must respect.
*/
function plannerPrompt(task, mode, catalog, maxNodes) {
	const catalogText = catalog.length === 0 ? "No explicit model catalog is available; omit `route` on every task." : catalog.map((entry) => `- ${entry.provider}: ${entry.models.join(", ")}`).join("\n");
	return `You are the planner of a multi-agent orchestration run inside a git worktree.

Decompose the task below into at most ${maxNodes} subtasks for worker agents. ${mode === "parallel" ? "Produce only independent tasks (no `deps`) so they can execute fully in parallel." : mode === "hierarchical" ? "Produce a hierarchy: independent work tasks first, then `aggregate` tasks (kind \"aggregate\") that depend on related groups and synthesize their results." : "Choose the structure that fits the task: independent tasks run in parallel; use `deps` for ordering and `aggregate` tasks to synthesize groups of results."}

Rules:
- Every worker task must be self-contained: the worker sees ONLY its prompt, not this conversation.
- Assign each work task a disjoint file scope where possible — parallel workers share one worktree and overlapping edits conflict.
- Worker prompts must state concrete acceptance criteria.
- Use \`aggregate\` tasks to synthesize finished groups, not to edit files.
- Optionally pick a per-task \`route\` ONLY from this model catalog (provider + model). Assign stronger models to harder tasks.
${catalogText}

Return the structured plan only.

Task:
${task}`;
}
/**
* Build a worker/aggregate node prompt. Dependency outputs are inlined so the
* child needs no cross-session reads.
*/
function nodePrompt(node, runTask, depOutputs) {
	const depSection = node.deps.length === 0 ? "" : `\n\nCompleted dependency results (read-only context):\n${node.deps.map((dep) => {
		const output = depOutputs.get(dep) ?? "(no output)";
		return `--- ${dep} ---\n${output.length > DEP_OUTPUT_LIMIT ? `${output.slice(0, DEP_OUTPUT_LIMIT)}\n…(truncated)` : output}`;
	}).join("\n")}`;
	const aggregateNote = node.role === "aggregate" ? "\nYou are an aggregator: synthesize the dependency results into a coherent answer. Do not edit files." : "\nEdit files directly in your working directory (a git worktree). Keep changes inside the scope described above.";
	return `Overall task: ${runTask}\n\nYour subtask (${node.id}): ${node.title}\n\n${node.prompt}${depSection}${aggregateNote}`;
}
/** Structured schema handed to the validator subagent. */
const VALIDATION_OUTPUT_SCHEMA = {
	type: "object",
	required: ["verdict", "summary"],
	additionalProperties: false,
	properties: {
		verdict: {
			enum: ["pass", "fail"],
			description: "pass only when the changes plausibly satisfy the task."
		},
		summary: { type: "string" },
		issues: {
			type: "array",
			items: { type: "string" }
		}
	}
};
/**
* Build the validator instruction over the run's outputs and diff stat.
* @param task - the original user task.
* @param nodes - terminal plan nodes (the validator itself excluded).
* @param diffStat - `git diff --stat` of the prepared proposal.
*/
function validatorPrompt(task, nodes, diffStat) {
	return `You are the validator of a multi-agent orchestration run. Decide whether the combined results and the prepared diff plausibly satisfy the task. Fail on unresolved subtasks, contradictions, or empty/irrelevant diffs.

Task:
${task}

Subtask results:
${nodes.map((node) => {
		const output = node.output ?? node.error ?? "(no output)";
		const clipped = output.length > DEP_OUTPUT_LIMIT ? `${output.slice(0, DEP_OUTPUT_LIMIT)}\n…(truncated)` : output;
		return `--- ${node.id} (${node.status}) ---\n${clipped}`;
	}).join("\n")}

Prepared diff stat:
${diffStat || "(empty)"}

Return the structured verdict only.`;
}
/** Normalize planner output received as `unknown` into the {@link Plan} type. */
function coercePlan(value) {
	if (typeof value !== "object" || value === null || !Array.isArray(value.tasks)) throw new Error("planner structured output is not a plan object");
	for (const task of value.tasks) if (typeof task !== "object" || task === null || typeof task.id !== "string" || typeof task.title !== "string" || typeof task.prompt !== "string" || task.deps !== void 0 && (!Array.isArray(task.deps) || task.deps.some((dep) => typeof dep !== "string"))) throw new Error(`planner task is malformed: ${JSON.stringify(task?.id ?? task)}`);
	return value;
}
//#endregion
//#region lib/types/engine.js
/**
* The orchestration engine: plan → schedule → delegate → validate → propose.
* Every external capability arrives through the injected {@link EngineDeps}
* seam so the run loop is testable without a live Host.
* @module dsh-orchestrator/engine
*/
/**
* Runs orchestration over submitted tasks. The engine owns no plugin
* lifecycle — callers persist and dispose it with the owning service.
*/
var OrchestratorEngine = class {
	deps;
	live = /* @__PURE__ */ new Map();
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Create the durable record and launch the run in the background.
	* @returns the freshly persisted run record (status `planning`).
	*/
	async submit(input, parentAgent) {
		if (!isAbsolute(input.cwd)) throw new Error("submit requires an absolute cwd");
		const id = `run-${randomUUID()}`;
		const record = {
			id,
			task: input.task,
			cwd: input.cwd,
			status: "planning",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			worktree: null,
			nodes: [],
			proposal: null,
			validation: null,
			error: null,
			rootSessionId: `orch-${id}`,
			mode: input.mode ?? "auto"
		};
		const live = {
			record,
			abort: new AbortController(),
			rootHandle: null,
			active: /* @__PURE__ */ new Map(),
			done: Promise.resolve(),
			routes: {
				planner: {
					...this.deps.routes.planner,
					...input.routes?.planner
				},
				worker: {
					...this.deps.routes.worker,
					...input.routes?.worker
				},
				validator: {
					...this.deps.routes.validator,
					...input.routes?.validator
				}
			}
		};
		this.live.set(id, live);
		await this.deps.persist(record);
		live.done = this.execute(live, input, parentAgent).catch((error) => {
			record.status = live.abort.signal.aborted ? "cancelled" : "failed";
			record.error = error instanceof Error ? error.message : String(error);
		}).finally(async () => {
			await live.rootHandle?.dispose();
			record.updatedAt = Date.now();
			await this.deps.persist(record);
			this.live.delete(id);
		});
		return record;
	}
	/** Abort in-flight work and settle the run as `cancelled`. */
	async cancel(runId) {
		const live = this.live.get(runId);
		if (live === void 0) return;
		live.abort.abort();
		for (const run of live.active.values()) await run.dispose();
		await live.done;
	}
	/**
	* Apply the reviewed proposal into the target repository. The hash binds the
	* approval to the exact diff the user saw; a stale worktree or a moved HEAD
	* rejects before anything is written.
	* @param runId - the run in `awaiting-approval`.
	* @param hash - the sha256 the UI displayed at review time.
	* @param record - the current durable record (fetched by the caller).
	*/
	async apply(runId, hash, record) {
		if (record.status !== "awaiting-approval" || record.proposal === null) throw new Error(`run ${runId} has no pending proposal`);
		if (record.proposal.hash !== hash) throw new Error("proposal hash mismatch — the reviewed diff is not the pending one");
		if (record.worktree === null) throw new Error("run worktree is gone; the proposal cannot be revalidated");
		const head = (await git(this.deps.subprocess, record.cwd, ["rev-parse", "HEAD"])).trim();
		if (head !== record.proposal.baseRev) throw new Error(`target HEAD moved (${head} != ${record.proposal.baseRev}); re-run or rebase the proposal`);
		const fresh = await collectDiff(this.deps.subprocess, record.worktree);
		if (fresh === null || fresh.hash !== hash) throw new Error("worktree contents changed since review; rejecting apply");
		const headNow = (await git(this.deps.subprocess, record.cwd, ["rev-parse", "HEAD"])).trim();
		if (headNow !== record.proposal.baseRev) throw new Error(`target HEAD moved (${headNow} != ${record.proposal.baseRev}); re-run or rebase the proposal`);
		await applyDiff(this.deps.subprocess, record.cwd, fresh.diff);
	}
	/**
	* Remove the run's worktree. Only valid once the run is terminal. The
	* directory is left in place when git refuses — nothing is force-deleted.
	*/
	async discard(runId, record) {
		if (record.status === "planning" || record.status === "running") throw new Error(`run ${runId} is still active; cancel it first`);
		if (record.worktree !== null) await removeWorktree(this.deps.subprocess, record.cwd, record.worktree);
	}
	/** The live controller of a running run, for cancel wiring and tests. */
	liveRun(runId) {
		return this.live.get(runId);
	}
	/** The full run lifecycle after the record exists. */
	async execute(live, input, parentAgent) {
		const { record } = live;
		const signal = live.abort.signal;
		await mkdir(this.deps.worktreeRoot, { recursive: true });
		const worktreePath = join(this.deps.worktreeRoot, record.id);
		const baseRev = await createWorktree(this.deps.subprocess, record.cwd, worktreePath, signal);
		record.worktree = worktreePath;
		const rootHandle = await this.deps.agents.create({
			sessionId: brandString(record.rootSessionId),
			...parentAgent !== void 0 ? { parentAgent } : {},
			meta: { cwd: worktreePath },
			agentOptions: this.routeOptions(live.routes.planner),
			signal
		});
		live.rootHandle = rootHandle;
		const parent = rootHandle.agent;
		record.updatedAt = Date.now();
		await this.deps.persist(record);
		const catalog = await this.deps.catalog();
		const planResult = await this.dispatch(live, {
			label: `${record.id}/plan`,
			prompt: plannerPrompt(record.task, record.mode, catalog, this.deps.maxNodes),
			route: live.routes.planner,
			outputSchema: PLAN_OUTPUT_SCHEMA
		}, parent);
		if (planResult.structured === void 0) throw new Error(`planner produced no structured plan (stopReason: ${planResult.stopReason})`);
		const nodes = buildGraph(coercePlan(planResult.structured), {
			maxNodes: this.deps.maxNodes,
			workerRoute: live.routes.worker,
			...catalog.length > 0 ? { allowedProviders: new Set(catalog.map((entry) => entry.provider)) } : {}
		});
		attachValidator(nodes, live.routes.validator);
		record.nodes = this.project(nodes);
		record.status = "running";
		record.updatedAt = Date.now();
		await this.deps.persist(record);
		const depOutputs = /* @__PURE__ */ new Map();
		const inFlight = /* @__PURE__ */ new Map();
		const launch = async (node) => {
			node.status = "running";
			let prompt = nodePrompt(node, record.task, depOutputs);
			if (node.role === "validator") {
				const staged = await collectDiff(this.deps.subprocess, worktreePath, signal);
				prompt = validatorPrompt(record.task, [...nodes.values()].filter((n) => n.role !== "validator"), staged?.stat ?? "");
			}
			const task = this.dispatch(live, {
				label: `${record.id}/${node.id}`,
				prompt,
				route: node.route,
				...node.role === "validator" ? { outputSchema: VALIDATION_OUTPUT_SCHEMA } : {}
			}, parent, node).then(async (result) => {
				inFlight.delete(node.id);
				if (result.stopReason === "completed") {
					node.output = result.output;
					node.error = null;
					if (node.role === "validator") {
						const verdict = result.structured;
						record.validation = verdict === void 0 ? {
							verdict: "fail",
							summary: "validator returned no structured verdict",
							issues: []
						} : {
							verdict: verdict.verdict === "fail" ? "fail" : "pass",
							summary: String(verdict.summary ?? ""),
							issues: Array.isArray(verdict.issues) ? verdict.issues.map(String) : []
						};
						node.output = record.validation.summary;
					}
					depOutputs.set(node.id, node.output);
					node.status = "done";
				} else {
					const detail = result.diagnostic ?? result.stopReason;
					if (result.retryable && node.attempts < this.deps.maxAttempts && !signal.aborted) {
						node.status = "pending";
						node.error = detail;
					} else {
						node.status = "failed";
						node.error = detail;
					}
				}
				await this.deps.persist(this.snapshot(record, nodes));
			}, async (error) => {
				inFlight.delete(node.id);
				node.status = "failed";
				node.error = error instanceof Error ? error.message : String(error);
				await this.deps.persist(this.snapshot(record, nodes));
			});
			inFlight.set(node.id, task);
		};
		while (!isSettled(nodes)) {
			if (signal.aborted) break;
			cascadeSkipped(nodes);
			const slots = this.deps.maxConcurrency - inFlight.size;
			for (const node of readyNodes(nodes).slice(0, Math.max(0, slots))) await launch(node);
			if (inFlight.size === 0) {
				cascadeSkipped(nodes);
				if (isSettled(nodes)) break;
				for (const node of nodes.values()) if (node.status === "pending") node.status = "skipped";
				break;
			}
			await Promise.race(inFlight.values());
		}
		await Promise.allSettled(inFlight.values());
		await this.deps.persist(this.snapshot(record, nodes));
		const failed = failedNodes(nodes);
		if (signal.aborted) {
			record.status = "cancelled";
			record.error = "cancelled by user";
			return;
		}
		if (failed.length > 0) {
			record.status = "failed";
			record.error = `failed nodes: ${failed.map((n) => `${n.id} (${n.error ?? "unknown"})`).join(", ")}`;
			return;
		}
		if (record.validation === null) {
			record.status = "failed";
			record.error = "validator produced no verdict";
			return;
		}
		if (record.validation.verdict !== "pass") {
			record.status = "failed";
			record.error = `validation failed: ${record.validation.summary}`;
			return;
		}
		const proposal = await collectDiff(this.deps.subprocess, worktreePath, signal);
		if (proposal === null) {
			record.status = "done";
			return;
		}
		record.proposal = {
			hash: proposal.hash,
			baseRev,
			stat: proposal.stat,
			diff: proposal.diff
		};
		record.status = "awaiting-approval";
	}
	/**
	* One delegation attempt through the driver. The attempt timeout composes
	* with the run abort; the delegated run is always disposed.
	*/
	async dispatch(live, spec, parent, node) {
		node && (node.attempts += 1);
		const attemptSignal = AbortSignal.any([live.abort.signal, AbortSignal.timeout(this.deps.nodeTimeoutMs)]);
		const run = await this.deps.driver.start({
			label: spec.label,
			prompt: spec.prompt,
			parent,
			signal: attemptSignal,
			route: spec.route,
			...spec.outputSchema !== void 0 ? { outputSchema: spec.outputSchema } : {},
			toolFilter: { deny: [...this.deps.toolDeny] }
		});
		const key = node?.id ?? spec.label;
		live.active.set(key, run);
		if (live.abort.signal.aborted) {
			live.active.delete(key);
			await run.dispose();
			return {
				output: "",
				stopReason: "aborted",
				retryable: false
			};
		}
		try {
			return await run.result;
		} finally {
			live.active.delete(key);
			await run.dispose();
		}
	}
	/** Map a route into the factory's `agentOptions` vocabulary. */
	routeOptions(route) {
		const options = {};
		if (route.provider !== void 0) options.provider = route.provider;
		if (route.model !== void 0) options.model = route.model;
		if (route.reasoningEffort !== void 0) options.reasoningEffort = route.reasoningEffort;
		return options;
	}
	/** Project the runtime graph into the stored wire view. */
	project(nodes) {
		return [...nodes.values()].map((node) => ({
			id: node.id,
			title: node.title,
			parentId: node.parentId,
			deps: node.deps,
			role: node.role,
			route: node.route,
			status: node.status,
			attempts: node.attempts,
			output: node.output,
			error: node.error
		}));
	}
	/** Persist with a refreshed node projection and timestamp. */
	snapshot(record, nodes) {
		record.updatedAt = Date.now();
		record.nodes = this.project(nodes);
		return record;
	}
};
//#endregion
//#region lib/types/driver.js
/**
* The provider adapter boundary. The engine talks to {@link OrchestratorDriver}
* only; {@link SubagentDriver} adapts the native `ctx.subagents` seam, and
* tests substitute a scripted driver. No provider-specific logic may appear
* outside this module.
* @module dsh-orchestrator/driver
*/
/** `stopReason` values worth a retry under the configured attempt limit. */
const RETRYABLE_STOP_REASONS = /* @__PURE__ */ new Set(["error", "max-tokens"]);
/** Flatten content blocks into display text for node outputs. */
function contentText(blocks) {
	const parts = [];
	for (const block of blocks) if (block.type === "text") parts.push(block.text);
	return parts.join("");
}
/**
* Driver over the native `ctx.subagents` seam. One provider name covers every
* node; per-node model routes ride `agentOptions`, which in-process providers
* merge over the parent's current route.
*/
var SubagentDriver = class {
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
		if (request.route.provider !== void 0) agentOptions.provider = request.route.provider;
		if (request.route.model !== void 0) agentOptions.model = request.route.model;
		if (request.route.reasoningEffort !== void 0) agentOptions.reasoningEffort = request.route.reasoningEffort;
		const run = await this.subagents.start(this.providerName, {
			label: request.label,
			prompt: [{
				type: "text",
				text: request.prompt
			}],
			parent: request.parent,
			signal: request.signal,
			agentOptions,
			...request.outputSchema !== void 0 ? { outputSchema: request.outputSchema } : {},
			...request.toolFilter !== void 0 ? { toolFilter: request.toolFilter } : {},
			...request.persona !== void 0 ? { persona: request.persona } : {},
			...this.maxDepth !== void 0 ? { maxDepth: this.maxDepth } : {}
		});
		return {
			result: run.result.then((result) => ({
				output: contentText(result.output),
				...result.structured !== void 0 ? { structured: result.structured } : {},
				stopReason: result.stopReason,
				...result.diagnostic !== void 0 ? { diagnostic: result.diagnostic } : {},
				retryable: RETRYABLE_STOP_REASONS.has(result.stopReason)
			})),
			dispose: () => run.dispose()
		};
	}
};
//#endregion
//#region lib/types/domain.js
/**
* Durable run records for the orchestrator domain. The stored record is the
* wire view plus host-private fields needed for recovery; the Remote surface
* projects only {@link OrchestratorRunView}.
* @module dsh-orchestrator/domain
*/
const routeSchema$1 = z$1.object({
	provider: z$1.string().optional(),
	model: z$1.string().optional(),
	reasoningEffort: z$1.string().optional()
});
const nodeSchema = z$1.object({
	id: z$1.string(),
	title: z$1.string(),
	parentId: z$1.string().nullable(),
	deps: z$1.array(z$1.string()),
	role: z$1.enum([
		"worker",
		"aggregate",
		"validator"
	]),
	route: routeSchema$1,
	status: z$1.enum([
		"pending",
		"running",
		"done",
		"failed",
		"skipped"
	]),
	attempts: z$1.number(),
	output: z$1.string().nullable(),
	error: z$1.string().nullable()
});
const proposalSchema = z$1.object({
	hash: z$1.string(),
	baseRev: z$1.string(),
	stat: z$1.string(),
	diff: z$1.string()
});
const validationSchema = z$1.object({
	verdict: z$1.enum(["pass", "fail"]),
	summary: z$1.string(),
	issues: z$1.array(z$1.string())
});
const orchestratorRunSchema = z$1.object({
	id: z$1.string(),
	task: z$1.string(),
	cwd: z$1.string(),
	status: z$1.enum([
		"planning",
		"running",
		"awaiting-approval",
		"applied",
		"done",
		"failed",
		"cancelled",
		"interrupted",
		"discarded"
	]),
	createdAt: z$1.number(),
	updatedAt: z$1.number(),
	worktree: z$1.string().nullable(),
	nodes: z$1.array(nodeSchema),
	proposal: proposalSchema.nullable(),
	validation: validationSchema.nullable(),
	error: z$1.string().nullable(),
	rootSessionId: z$1.string(),
	mode: z$1.enum([
		"auto",
		"parallel",
		"hierarchical"
	])
});
/**
* Orchestrator domain declaration — one table of runs. The record schema is
* wider than {@link OrchestratorRunRecord} only in optional-vs-undefined
* fields, so the boundary cast is exact-shape.
*/
const ORCHESTRATOR_DOMAIN = defineDomain({
	name: "orchestrator",
	version: 1,
	tables: { runs: domainTable(orchestratorRunSchema) }
});
//#endregion
//#region lib/types/index.js
/**
* Host owner of the `orchestrator` Remote namespace: accepts one complex
* development task, plans it into isolated subagent delegations, validates the
* combined result, and prepares a worktree diff that applies only through an
* exact-hash approval. All writes happen inside a per-run git worktree; the
* user's workspace is untouched until {@link apply} revalidates the reviewed
* diff.
* @module dsh-orchestrator
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
const routeSchema = z.object({
	provider: z.string(),
	model: z.string(),
	reasoningEffort: z.string()
});
/** Default worktree root when the deployment does not configure one. */
function defaultWorktreeRoot() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "orchestrator");
}
/** Host service backing the generated `ctx.remote.orchestrator` namespace. */
let OrchestratorController = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _submit_decorators;
	let _listRuns_decorators;
	let _getRun_decorators;
	let _watch_decorators;
	let _cancel_decorators;
	let _apply_decorators;
	let _discard_decorators;
	let _listRoutes_decorators;
	return class OrchestratorController extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_submit_decorators = [Remote];
			_listRuns_decorators = [Remote];
			_getRun_decorators = [Remote];
			_watch_decorators = [Remote({ mode: "stream" })];
			_cancel_decorators = [Remote];
			_apply_decorators = [Remote];
			_discard_decorators = [Remote];
			_listRoutes_decorators = [Remote];
			__esDecorate(this, null, _submit_decorators, {
				kind: "method",
				name: "submit",
				static: false,
				private: false,
				access: {
					has: (obj) => "submit" in obj,
					get: (obj) => obj.submit
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _listRuns_decorators, {
				kind: "method",
				name: "listRuns",
				static: false,
				private: false,
				access: {
					has: (obj) => "listRuns" in obj,
					get: (obj) => obj.listRuns
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getRun_decorators, {
				kind: "method",
				name: "getRun",
				static: false,
				private: false,
				access: {
					has: (obj) => "getRun" in obj,
					get: (obj) => obj.getRun
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _watch_decorators, {
				kind: "method",
				name: "watch",
				static: false,
				private: false,
				access: {
					has: (obj) => "watch" in obj,
					get: (obj) => obj.watch
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _cancel_decorators, {
				kind: "method",
				name: "cancel",
				static: false,
				private: false,
				access: {
					has: (obj) => "cancel" in obj,
					get: (obj) => obj.cancel
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _apply_decorators, {
				kind: "method",
				name: "apply",
				static: false,
				private: false,
				access: {
					has: (obj) => "apply" in obj,
					get: (obj) => obj.apply
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _discard_decorators, {
				kind: "method",
				name: "discard",
				static: false,
				private: false,
				access: {
					has: (obj) => "discard" in obj,
					get: (obj) => obj.discard
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _listRoutes_decorators, {
				kind: "method",
				name: "listRoutes",
				static: false,
				private: false,
				access: {
					has: (obj) => "listRoutes" in obj,
					get: (obj) => obj.listRoutes
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		config = __runInitializers(this, _instanceExtraInitializers);
		static inject = [
			"typert",
			"subagents",
			"agents",
			"storageDomain",
			"subprocess",
			"llm",
			"tools"
		];
		static Config = z.object({
			subagentProvider: z.string().default("spawn"),
			routeProviders: z.array(z.string()).default([]),
			plannerRoute: routeSchema,
			workerRoute: routeSchema,
			validatorRoute: routeSchema,
			maxConcurrency: z.number().min(1).max(8).default(3),
			maxNodes: z.number().min(1).max(16).default(8),
			maxAttempts: z.number().min(1).max(4).default(2),
			nodeTimeoutMs: z.number().min(1e4).default(9e5),
			maxDepth: z.number().min(0).max(4).default(0),
			worktreeRoot: z.string(),
			toolDeny: z.array(z.string()).default(["orchestrate"])
		});
		/** Resolved once the domain is open, stale runs are marked, and the engine is live. */
		ready;
		engine;
		domain;
		constructor(ctx, config) {
			super(ctx, "orchestratorController", { namespace: "orchestrator" });
			this.config = config;
			this.ready = this.init(ctx);
		}
		async init(ctx) {
			const domain = await ctx.storageDomain.open(ORCHESTRATOR_DOMAIN);
			this.domain = domain;
			ctx.effect(() => () => domain.close());
			const table = domain.table("runs");
			for (const [id, record] of table.entries()) if (record.status === "planning" || record.status === "running") await table.put(id, {
				...record,
				status: "interrupted",
				error: "host restarted mid-run",
				updatedAt: Date.now()
			});
			const persist = async (record) => {
				await table.put(record.id, record);
			};
			const config = this.config;
			const deps = {
				driver: new SubagentDriver(ctx.subagents, config.subagentProvider ?? "spawn", config.maxDepth),
				agents: { create: (options) => ctx.agents.create({
					sessionId: options.sessionId,
					meta: options.meta,
					...options.parentAgent !== void 0 ? { parentAgent: options.parentAgent } : {},
					...options.agentOptions !== void 0 ? { agentOptions: options.agentOptions } : {},
					...options.signal !== void 0 ? { signal: options.signal } : {}
				}) },
				subprocess: ctx.subprocess,
				persist,
				worktreeRoot: config.worktreeRoot ?? defaultWorktreeRoot(),
				maxConcurrency: config.maxConcurrency ?? 3,
				maxNodes: config.maxNodes ?? 8,
				maxAttempts: config.maxAttempts ?? 2,
				nodeTimeoutMs: config.nodeTimeoutMs ?? 9e5,
				toolDeny: config.toolDeny ?? ["orchestrate"],
				routes: {
					planner: config.plannerRoute ?? {},
					worker: config.workerRoute ?? {},
					validator: config.validatorRoute ?? {}
				},
				catalog: () => this.catalog()
			};
			this.engine = new OrchestratorEngine(deps);
			const engine = this.engine;
			ctx.effect(() => ctx.tools.register(defineTool({
				name: "orchestrate",
				description: "Decompose a complex development task into isolated sub-agent runs inside a git worktree, execute them in parallel, validate the combined result, and propose a diff that applies only after the user approves it in the Orchestrator panel.",
				parameters: {
					task: {
						type: "string",
						required: true,
						description: "The complex development task."
					},
					cwd: {
						type: "string",
						description: "Absolute path of the target git repository. Defaults to the current workspace."
					}
				},
				output: {
					schema: { type: "string" },
					render: (_args, value) => [{
						type: "text",
						text: value
					}]
				},
				async execute(args, exec) {
					const cwd = args.cwd ?? exec.agent?.session.header.cwd;
					if (cwd === void 0 || cwd === null) throw new Error("no cwd given and the calling session has none");
					return `orchestration run ${(await engine.submit({
						task: args.task,
						cwd
					}, exec.agent)).id} started; approve the proposed diff in the Orchestrator panel when it appears`;
				},
				presentCall: () => ({
					card: "generic",
					title: "Orchestrate task",
					kind: "other"
				})
			})));
		}
		async catalog() {
			const entries = [];
			for (const provider of this.config.routeProviders ?? []) {
				const models = await this.ctx.llm.listModels(provider);
				entries.push({
					provider,
					models: models.map((m) => m.id)
				});
			}
			return entries;
		}
		/** Submit a new orchestration run. @returns the created run record. */
		async submit(input) {
			await this.ready;
			if (typeof input?.task !== "string" || input.task.trim().length === 0) throw new Error("submit requires a non-empty task");
			if (typeof input.cwd !== "string" || !input.cwd.startsWith("/")) throw new Error("submit requires an absolute cwd");
			const record = await this.engine.submit(input);
			return this.view(record);
		}
		/** List every run, newest first. */
		async listRuns() {
			await this.ready;
			return [...this.domain.table("runs").entries()].map(([, record]) => record).sort((a, b) => b.createdAt - a.createdAt).map((record) => this.view(record));
		}
		/** Fetch one run by id. */
		async getRun(runId) {
			await this.ready;
			const record = this.domain.table("runs").get(runId);
			return record === void 0 ? null : this.view(record);
		}
		/** Stream the full run list on every durable change. */
		async *watch(signal) {
			await this.ready;
			const push = async function* (controller) {
				yield await controller.listRuns();
				const queue = [];
				const off = controller.ctx.on("domain/changed", (event) => {
					if (event.domain === "orchestrator") queue.shift()?.();
				});
				try {
					while (!signal.aborted) {
						await new Promise((resolve) => queue.push(resolve));
						if (signal.aborted) break;
						yield await controller.listRuns();
					}
				} finally {
					off();
				}
			};
			yield* push(this);
		}
		/** Cancel a live run. */
		async cancel(runId) {
			await this.ready;
			if (this.domain.table("runs").get(runId) === void 0) throw new Error(`unknown run ${runId}`);
			await this.engine.cancel(runId);
		}
		/**
		* Apply the reviewed proposal. `hash` must equal the diff hash shown at
		* review time — the service re-validates the worktree before writing.
		*/
		async apply(runId, hash) {
			await this.ready;
			const table = this.domain.table("runs");
			const record = table.get(runId);
			if (record === void 0) throw new Error(`unknown run ${runId}`);
			await this.engine.apply(runId, hash, record);
			await table.put(runId, {
				...record,
				status: "applied",
				updatedAt: Date.now()
			});
		}
		/** Remove a terminal run's worktree and mark the record discarded. */
		async discard(runId) {
			await this.ready;
			const table = this.domain.table("runs");
			const record = table.get(runId);
			if (record === void 0) throw new Error(`unknown run ${runId}`);
			await this.engine.discard(runId, record);
			await table.put(runId, {
				...record,
				worktree: null,
				updatedAt: Date.now()
			});
		}
		/** The configured model routes for the UI picker. */
		async listRoutes() {
			await this.ready;
			return (await this.catalog()).map((entry) => ({
				provider: entry.provider,
				models: entry.models.map((id) => ({
					id,
					name: null
				}))
			}));
		}
		/** Project a stored record to the wire view (drops recovery-only fields). */
		view(record) {
			return {
				id: record.id,
				task: record.task,
				cwd: record.cwd,
				status: record.status,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
				worktree: record.worktree,
				nodes: record.nodes,
				proposal: record.proposal,
				validation: record.validation,
				error: record.error
			};
		}
	};
})();
//#endregion
export { ORCHESTRATOR_DOMAIN, OrchestratorController, OrchestratorController as default };
