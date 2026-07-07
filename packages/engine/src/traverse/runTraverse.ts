import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HopReport, type TraceState } from '@lightsout/contracts';
import { buildTraverseHopInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { defaultWorkspaceDir } from './common/constants/defaultWorkspaceDir';
import { hopSinks } from './common/utils/hopSinks';
import { readConnectionGraph } from './common/utils/readConnectionGraph';
import { reportHopUsage } from './common/utils/reportHopUsage';
import { resolveRunDir } from './common/utils/resolveRunDir';
import { ensureNodeWorkspace } from './ensureNodeWorkspace';
import { initTraverseState } from './initTraverseState';
import { invokeAgentWithContract } from '../invoke';
import { matchExitToEdge } from './matchExitToEdge';
import { writeJsonFile } from '../common/utils/writeJsonFile';

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
	workspaceDir = defaultWorkspaceDir,
	resumeRunId,
	model,
	permissionMode,
	timeoutMs = defaultHopTimeoutMs,
	onProgress,
}: Params) => {
	const progress = onProgress ?? (() => undefined);
	const { edges, registry } = await readConnectionGraph({ cwd, connectionsDir });

	const { runId, runDir, tracePath } = resolveRunDir({ cwd, kind: 'traverse', resumeRunId });

	await mkdir(runDir, { recursive: true });
	await mkdir(workspaceDir, { recursive: true });

	const state = await initTraverseState({ resumeRunId, tracePath, edges, start, question, dataOfInterest, budget, runId, progress });

	const writeTrace = async () => writeJsonFile({ path: tracePath, value: state });

	await writeTrace();

	// A hop that never completed (rate limit, or an absent report): re-enqueue
	// the edge it never finished, persist, and stop with the reason for the human.
	const bail = async ({ entry, status, error }: { entry: TraceState['frontier'][number]; status: 'paused-rate-limit' | 'failed'; error: string }) => {
		state.frontier.unshift(entry);
		await writeTrace();

		return { status, state, runId, runDir, error };
	};

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
			...hopSinks({ runDir, hopNumber }),
		});

		reportHopUsage({ usage, hopNumber: state.budget.used + 1, progress });

		if (rateLimited) {
			return bail({ entry: next, status: 'paused-rate-limit', error: `rate limit reached — resume with: lightsout traverse --run ${runId}` });
		}

		if (!report) {
			return bail({ entry: next, status: 'failed', error: `hop into ${node} failed: ${failure}` });
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
