import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { HopReport, TraceState } from '@lightsout/contracts';
import { buildTraverseHopInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { ensureNodeWorkspace } from './ensureNodeWorkspace';
import { invokeAgentWithContract } from './invoke';
import { matchExitToEdge } from './matchExitToEdge';
import { readConnectionMap } from './readConnectionMap';
import { readNodeRegistry } from './readNodeRegistry';

const defaultBudget = 12;
const defaultHopTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	question: string;
	/** Directory of connection docs + repos.yaml (cwd-relative or absolute). */
	connectionsDir: string;
	/** The specific payload/field/behavior to follow. Defaults to the question itself. */
	dataOfInterest?: string;
	/** Edge id or node name to start from. Required unless resuming. */
	start?: string;
	budget?: number;
	/** Shared clone workspace. Defaults to ~/.lightsout/traverse-repos. */
	workspaceDir?: string;
	/** Resume a prior run's trace from its saved frontier. */
	resumeRunId?: string;
	model?: string;
	permissionMode?: string;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/**
 * Cross-repo data-flow traversal: recursion flattened into a worklist loop
 * the ENGINE owns — frontier + visited set + hop budget enforced in code,
 * trace state rewritten to disk after every hop (resumable, auditable), one
 * traverse-hop agent per hop that is structurally unable to recurse. This
 * supersedes the prototype's skill-run loop (its T11 predicted exactly this)
 * and its YAML reports (JSON through the engine's contract boundary, same
 * substance as T12). Unmapped exits become GAPs, never guesses.
 */
export const runTraverse = async ({
	cwd,
	driver,
	question,
	connectionsDir,
	dataOfInterest,
	start,
	budget,
	workspaceDir = join(homedir(), '.lightsout', 'traverse-repos'),
	resumeRunId,
	model,
	permissionMode,
	timeoutMs = defaultHopTimeoutMs,
	onProgress,
}: Params) => {
	const progress = onProgress ?? (() => undefined);
	const mapDir = isAbsolute(connectionsDir) ? connectionsDir : join(cwd, connectionsDir);
	const edges = await readConnectionMap({ connectionsDir: mapDir });
	const registry = await readNodeRegistry({ connectionsDir: mapDir });

	// Full timestamp to the second (colons → dashes for the filesystem) so a
	// lexicographic sort of the run dirs IS chronological. The short hash only
	// guards same-second collisions.
	const runId = resumeRunId ?? `${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}-${randomUUID().slice(0, 8)}`;
	const runDir = join(cwd, '.lightsout', 'traverse', runId);
	const tracePath = join(runDir, 'trace.json');

	await mkdir(runDir, { recursive: true });
	await mkdir(workspaceDir, { recursive: true });

	let state: TraceState;

	if (resumeRunId) {
		const raw = await readFile(tracePath, 'utf8').catch(() => {
			throw new Error(`no trace found for run ${resumeRunId} at ${tracePath}`);
		});

		state = TraceState.parse(JSON.parse(raw));

		// A budget-exhausted run resumes with a fresh window (that's what
		// resuming means for it); an explicit --budget sets the window size.
		if (state.budget.used >= state.budget.maxHops) {
			state.budget.maxHops = state.budget.used + (budget ?? state.budget.maxHops);
		}

		progress(`resuming run ${runId}: ${state.frontier.length} edge(s) on the frontier, ${state.budget.used}/${state.budget.maxHops} hops used`);
	} else {
		if (!start) {
			throw new Error(`--start is required (an edge id or node name). Known edges: ${[...edges.keys()].join(', ') || 'none'}`);
		}

		const seeds = edges.has(start)
			? [start]
			: [...edges.entries()].filter(([, doc]) => doc.from === start).map(([id]) => id);

		if (seeds.length === 0) {
			throw new Error(`'${start}' is neither an edge id nor a node with outbound edges. Known edges: ${[...edges.keys()].join(', ') || 'none'}`);
		}

		state = {
			question,
			dataOfInterest: dataOfInterest ?? question,
			budget: { maxHops: budget ?? defaultBudget, used: 0 },
			frontier: seeds.map((edge) => ({ edge, reason: `seeded from --start ${start}` })),
			visited: [],
			hops: [],
			gaps: [],
			drift: [],
			answer: null,
		};
		progress(`traverse ${runId}: seeded ${seeds.length} edge(s) from '${start}' · budget ${state.budget.maxHops} hops`);
	}

	const writeTrace = async () => writeFile(tracePath, `${JSON.stringify(state, undefined, '\t')}\n`, 'utf8');

	await writeTrace();

	const enqueue = ({ edge, reason }: { edge: string; reason: string }) => {
		if (!state.visited.includes(edge) && !state.frontier.some((entry) => entry.edge === edge)) {
			state.frontier.push({ edge, reason });
		}
	};

	while (state.frontier.length > 0 && state.budget.used < state.budget.maxHops) {
		const next = state.frontier.shift();

		if (!next || state.visited.includes(next.edge)) {
			continue;
		}

		const doc = edges.get(next.edge);

		if (!doc) {
			state.gaps.push({ node: 'unknown', detail: `frontier edge '${next.edge}' has no connection doc — stale frontier entry` });
			state.visited.push(next.edge);
			await writeTrace();
			continue;
		}

		const node = doc.to;
		const source = registry.get(node);

		// Non-repo node (AWS service, external system): crossed mechanically —
		// no agent, no budget; traversal continues from its downstream edges.
		if (!source) {
			state.visited.push(next.edge);
			state.hops.push({ edge: next.edge, node, note: 'non-repo node — crossed mechanically; continuing from its downstream edges' });

			for (const [id, candidate] of edges) {
				if (candidate.from === node) {
					enqueue({ edge: id, reason: `continues downstream of non-repo node ${node}` });
				}
			}

			progress(`hop —: ${next.edge} → ${node} (non-repo node, crossed mechanically)`);
			await writeTrace();
			continue;
		}

		if (!doc.toAnchor) {
			state.gaps.push({ node, detail: `edge '${next.edge}' has no to-anchor — cannot enter a repo node without one (repair with map-connection)` });
			state.visited.push(next.edge);
			await writeTrace();
			continue;
		}

		const workspace = await ensureNodeWorkspace({ repo: source.repo, workspaceDir });
		const contextDocs = doc.additionalContext
			.filter((entry) => entry.startsWith(`${node}:`))
			.map((entry) => join(workspace, entry.slice(node.length + 1)));

		progress(`hop ${state.budget.used + 1}/${state.budget.maxHops}: ${next.edge} → ${node} (${next.reason})`);

		const hopNumber = state.hops.length + 1;
		const { report, failure, rateLimited, usage } = await invokeAgentWithContract({
			driver,
			cwd: workspace,
			invocation: buildTraverseHopInvocation({
				node,
				workspace,
				scope: source.path,
				entryAnchor: doc.toAnchor,
				question: state.question,
				dataOfInterest: state.dataOfInterest,
				contextDocs,
			}),
			contract: HopReport,
			model,
			permissionMode,
			timeoutMs,
			onEvent: (event) => {
				void appendFile(join(runDir, `hop-${hopNumber}-stream.jsonl`), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
			},
			onRejectedOutput: async ({ text, attempt }) => {
				await writeFile(join(runDir, `hop-${hopNumber}-rejected-${attempt}.txt`), text, 'utf8').catch(() => undefined);
			},
		});

		if (usage) {
			progress(`hop ${state.budget.used + 1} usage: out ${usage.outputTokens} · cache-read ${usage.cacheReadTokens} · $${usage.costUsd.toFixed(2)}`);
		}

		if (rateLimited) {
			// Re-enqueue the edge the hop never completed, then park.
			state.frontier.unshift(next);
			await writeTrace();

			return { status: 'paused-rate-limit' as const, state, runId, runDir, error: `rate limit reached — resume with: lightsout traverse --run ${runId}` };
		}

		if (!report) {
			state.frontier.unshift(next);
			await writeTrace();

			return { status: 'failed' as const, state, runId, runDir, error: `hop into ${node} failed: ${failure}` };
		}

		state.budget.used += 1;
		state.visited.push(next.edge);
		state.hops.push({ edge: next.edge, node, report });

		if (report.anchorCheck.status !== 'ok') {
			state.drift.push({ edge: next.edge, node, status: report.anchorCheck.status, foundAt: report.anchorCheck.foundAt });
		}

		for (const gap of report.gaps) {
			state.gaps.push({ node, detail: gap });
		}

		for (const exit of report.exits) {
			if (exit.relevant === 'no') {
				continue;
			}

			const matches = matchExitToEdge({ exit, node, edges });
			const exitRecord = { kind: exit.kind, target: exit.target, at: exit.at, carries: exit.carries };

			if (matches.length === 1 && matches[0]) {
				enqueue({ edge: matches[0], reason: `carries: ${exit.carries} (from ${node})` });
			} else if (matches.length === 0) {
				state.gaps.push({ node, exit: exitRecord, detail: 'no matching connection doc — unmapped edge (GAP); draft it with map-connection' });
			} else {
				state.gaps.push({ node, exit: exitRecord, detail: `ambiguous exit — matches ${matches.join(', ')}; disambiguate the docs' anchors` });
			}
		}

		await writeTrace();
	}

	const status = state.frontier.length === 0 ? ('complete' as const) : ('budget-exhausted' as const);

	await writeTrace();
	progress(
		status === 'complete'
			? `traverse complete: ${state.hops.length} hop(s), ${state.gaps.length} gap(s), ${state.drift.length} drift report(s)`
			: `budget exhausted (${state.budget.used}/${state.budget.maxHops}): ${state.frontier.length} edge(s) still on the frontier — resume with: lightsout traverse --run ${runId}`,
	);

	return { status, state, runId, runDir, error: undefined };
};
