import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { DebugHopReport, DebugTraceState } from '@lightsout/contracts';
import { buildDebugHopInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { defaultWorkspaceDir } from './common/constants/defaultWorkspaceDir';
import { mintRunId } from './common/utils/mintRunId';
import { ensureNodeWorkspace } from './ensureNodeWorkspace';
import { findConnectingDoc } from './findConnectingDoc';
import { invokeAgentWithContract } from '../invoke';
import { readConnectionMap } from './readConnectionMap';
import { readNodeRegistry } from './readNodeRegistry';
import { resolveSeedNode } from './resolveSeedNode';

const defaultBudget = 12;
const defaultHopTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	/** The bug description — symptoms x/y/z. */
	symptoms: string;
	connectionsDir: string;
	/** Explicit start node; when absent, the seed is inferred from the CWD. */
	start?: string;
	/** file:line hint narrowing the seed hop's entry; undefined = investigate the node broadly. */
	at?: string;
	/** A commit worth checking first ("bug started <date>, this hash may be the cause"). */
	suspectCommit?: string;
	budget?: number;
	workspaceDir?: string;
	resumeRunId?: string;
	model?: string;
	permissionMode?: string;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/**
 * Goal-directed cross-repo debugging on the shared traverse spine: a bounded,
 * resumable worklist loop the ENGINE owns, one non-recursive debug-hop agent
 * per node. Differs from runTraverse in the walk, not the spine — the agent's
 * job is root-cause-or-name-the-lead, the loop HALTS on a root-cause verdict,
 * leads are chased depth-first ONE at a time and BIDIRECTIONALLY (the agent
 * names a crossing + direction, findConnectingDoc routes it), and an evolving
 * hypothesis is threaded hop to hop. The seed hop reads the dev's local
 * working tree (CWD-seeded) or a full-history clone (--start); every other
 * hop clones full history for git archaeology. Unmapped leads are GAPs.
 */
export const runDebug = async ({
	cwd,
	driver,
	symptoms,
	connectionsDir,
	start,
	at,
	suspectCommit,
	budget,
	workspaceDir = defaultWorkspaceDir,
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

	const runId = resumeRunId ?? mintRunId();
	const runDir = join(cwd, '.lightsout', 'debug', runId);
	const tracePath = join(runDir, 'trace.json');

	await mkdir(runDir, { recursive: true });
	await mkdir(workspaceDir, { recursive: true });

	let state: DebugTraceState;

	if (resumeRunId) {
		const raw = await readFile(tracePath, 'utf8').catch(() => {
			throw new Error(`no debug trace found for run ${resumeRunId} at ${tracePath}`);
		});

		state = DebugTraceState.parse(JSON.parse(raw));

		if (state.budget.used >= state.budget.maxHops) {
			state.budget.maxHops = state.budget.used + (budget ?? state.budget.maxHops);
		}

		progress(`resuming debug ${runId}: ${state.frontier.length} lead(s), ${state.budget.used}/${state.budget.maxHops} hops used`);
	} else {
		const seed = await resolveSeedNode({ cwd, registry, edges, start });

		for (const note of seed.notes) {
			progress(note);
		}

		const hypothesis = suspectCommit ? `${symptoms} (suspect commit ${suspectCommit})` : symptoms;

		state = {
			seed: { node: seed.node, workspace: seed.workspace },
			symptoms,
			hypothesis,
			budget: { maxHops: budget ?? defaultBudget, used: 0 },
			frontier: [{ node: seed.node, viaEdge: null, direction: 'seed', hypothesis, reason: seed.notes[0] ?? 'seed' }],
			visited: [],
			hops: [],
			gaps: [],
			drift: [],
			resolution: null,
		};
		progress(`debug ${runId}: seeded at ${seed.node} · budget ${state.budget.maxHops} hops`);
	}

	const writeTrace = async () => writeFile(tracePath, `${JSON.stringify(state, undefined, '\t')}\n`, 'utf8');

	await writeTrace();

	const enqueue = (entry: DebugTraceState['frontier'][number]) => {
		const key = `${entry.node}+${entry.direction}`;

		if (!state.visited.includes(key) && !state.frontier.some((f) => `${f.node}+${f.direction}` === key)) {
			state.frontier.push(entry);
		}
	};

	while (state.frontier.length > 0 && state.budget.used < state.budget.maxHops && state.resolution === null) {
		const next = state.frontier.shift();

		if (!next) {
			continue;
		}

		const key = `${next.node}+${next.direction}`;

		if (state.visited.includes(key)) {
			continue;
		}

		const isSeed = next.direction === 'seed';
		const source = registry.get(next.node);

		// Non-repo node (AWS service, external system): no code to investigate —
		// cross it mechanically and continue in the same direction.
		if (!isSeed && !source) {
			state.visited.push(key);
			state.hops.push({ node: next.node, viaEdge: next.viaEdge, direction: next.direction, note: 'non-repo node — no code to investigate; crossed mechanically' });

			for (const [id, doc] of edges) {
				const onward = next.direction === 'downstream' ? doc.from === next.node : doc.to === next.node;

				if (onward) {
					enqueue({
						node: next.direction === 'downstream' ? doc.to : doc.from,
						viaEdge: id,
						direction: next.direction,
						hypothesis: next.hypothesis,
						reason: `continues ${next.direction} of non-repo node ${next.node}`,
					});
				}
			}

			progress(`hop —: ${next.node} (non-repo node, crossed mechanically)`);
			await writeTrace();
			continue;
		}

		// Resolve the workspace + entry anchor for this hop.
		let workspace: string;
		let scope: string | undefined;
		let entryAnchor: { path: string; pattern: string } | undefined;

		if (isSeed) {
			const seedWs = state.seed.workspace;
			scope = seedWs.kind === 'clone' ? seedWs.scope : undefined;
			workspace = seedWs.kind === 'local' ? seedWs.path : await ensureNodeWorkspace({ repo: seedWs.repo, workspaceDir, fullHistory: true });
			entryAnchor = at ? { path: at.split(':')[0] ?? at, pattern: at } : undefined;
		} else {
			if (!source) {
				continue;
			}

			const doc = next.viaEdge ? edges.get(next.viaEdge) : undefined;
			const anchor = doc ? (next.direction === 'downstream' ? doc.toAnchor : doc.fromAnchor) : undefined;

			if (!anchor) {
				state.gaps.push({ node: next.node, detail: `edge '${next.viaEdge}' has no ${next.direction === 'downstream' ? 'to' : 'from'}-anchor — cannot enter (repair with map-connection)` });
				state.visited.push(key);
				await writeTrace();
				continue;
			}

			scope = source.path;
			entryAnchor = anchor;
			workspace = await ensureNodeWorkspace({ repo: source.repo, workspaceDir, fullHistory: true });
		}

		progress(`hop ${state.budget.used + 1}/${state.budget.maxHops}: ${next.node} (${next.direction}) — ${next.reason}`);

		const hopNumber = state.hops.length + 1;
		const { report, failure, rateLimited, usage } = await invokeAgentWithContract({
			driver,
			cwd: workspace,
			invocation: buildDebugHopInvocation({ node: next.node, workspace, scope, symptoms: state.symptoms, hypothesis: next.hypothesis, entryAnchor, suspectCommit: isSeed ? suspectCommit : undefined }),
			contract: DebugHopReport,
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
			state.frontier.unshift(next);
			await writeTrace();

			return { status: 'paused-rate-limit' as const, state, runId, runDir, error: `rate limit reached — resume with: lightsout debug --run ${runId}` };
		}

		if (!report) {
			state.frontier.unshift(next);
			await writeTrace();

			return { status: 'failed' as const, state, runId, runDir, error: `debug hop into ${next.node} failed: ${failure}` };
		}

		state.budget.used += 1;
		state.visited.push(key);
		state.hops.push({ node: next.node, viaEdge: next.viaEdge, direction: next.direction, report });

		if (report.anchorCheck && report.anchorCheck.status !== 'ok') {
			state.drift.push({ node: next.node, viaEdge: next.viaEdge, status: report.anchorCheck.status, foundAt: report.anchorCheck.foundAt });
		}

		for (const gap of report.gaps) {
			state.gaps.push({ node: next.node, detail: gap });
		}

		if (report.verdict === 'root-cause' && report.rootCause && report.proposedFix) {
			state.resolution = { node: next.node, at: report.rootCause.at, explanation: report.rootCause.explanation, proposedFix: report.proposedFix };
			progress(`root cause found at ${next.node} — ${report.rootCause.at}`);
			await writeTrace();
			break;
		}

		if (report.verdict === 'points-elsewhere' && report.nextLead) {
			const matches = findConnectingDoc({ lead: report.nextLead, node: next.node, edges });
			const lead = report.nextLead;

			if (matches.length === 1 && matches[0] && matches[0].edge === next.viaEdge) {
				// Contradiction: this node points the fault back across the very edge
				// it was reached through — both endpoints blame the other. Ping-pong,
				// not a lead. Stop the branch and surface it (integration/contract
				// mismatch at the boundary, or no defect on this path) rather than
				// burning budget bouncing across it.
				state.gaps.push({ node: next.node, detail: `contradiction across ${next.viaEdge}: ${next.node} points the fault back over the edge it was reached through — both sides claim correctness. Inspect the boundary contract/integration, or reconsider whether a defect exists on this path. (${lead.why})` });
			} else if (matches.length === 1 && matches[0]) {
				enqueue({ node: matches[0].node, viaEdge: matches[0].edge, direction: lead.direction, hypothesis: lead.refinedHypothesis, reason: `${lead.direction} — ${lead.why}` });
			} else if (matches.length === 0) {
				state.gaps.push({ node: next.node, detail: `lead ${lead.direction} via ${lead.kind} '${lead.target}' at ${lead.at} matches no connection doc — unmapped (GAP); draft it with map-connection` });
			} else {
				state.gaps.push({ node: next.node, detail: `ambiguous ${lead.direction} lead (${lead.kind} '${lead.target}') — matches ${matches.map((m) => m.edge).join(', ')}; disambiguate the docs' anchors` });
			}
		}

		state.hypothesis = next.hypothesis;
		await writeTrace();
	}

	const status = state.resolution ? ('resolved' as const) : state.frontier.length === 0 ? ('unresolved' as const) : ('budget-exhausted' as const);

	await writeTrace();
	progress(
		status === 'resolved'
			? `debug complete: root cause at ${state.resolution?.node} (${state.hops.length} hop(s), ${state.gaps.length} gap(s))`
			: status === 'unresolved'
				? `debug exhausted the trail unresolved: ${state.hops.length} hop(s), ${state.gaps.length} gap(s) — the cause is beyond the mapped edges`
				: `budget exhausted (${state.budget.used}/${state.budget.maxHops}): ${state.frontier.length} lead(s) open — resume with: lightsout debug --run ${runId}`,
	);

	return { status, state, runId, runDir, error: undefined };
};
