import { readFile } from 'node:fs/promises';
import { type ConnectionDoc, DebugTraceState } from '@lightsout/contracts';
import { resolveSeedNode } from './resolveSeedNode';

const defaultBudget = 12;

interface Params {
	resumeRunId?: string;
	tracePath: string;
	cwd: string;
	registry: Map<string, { repo: string; path?: string }>;
	edges: Map<string, ConnectionDoc>;
	start?: string;
	symptoms: string;
	suspectCommit?: string;
	budget?: number;
	runId: string;
	progress: (message: string) => void;
}

/**
 * Build the trace state a debug run walks from: on resume, the saved trace
 * (with a fresh budget window when the prior run exhausted it); otherwise a
 * seed hop resolved from the CWD or `--start`, with the initial hypothesis
 * folding in any suspect commit.
 *
 * @throws {Error} when resuming without a saved debug trace, or when the seed
 * node cannot be resolved.
 */
export const initDebugState = async ({
	resumeRunId,
	tracePath,
	cwd,
	registry,
	edges,
	start,
	symptoms,
	suspectCommit,
	budget,
	runId,
	progress,
}: Params): Promise<DebugTraceState> => {
	if (resumeRunId) {
		const raw = await readFile(tracePath, 'utf8').catch(() => {
			throw new Error(`no debug trace found for run ${resumeRunId} at ${tracePath}`);
		});

		const state = DebugTraceState.parse(JSON.parse(raw));

		if (state.budget.used >= state.budget.maxHops) {
			state.budget.maxHops = state.budget.used + (budget ?? state.budget.maxHops);
		}

		progress(`resuming debug ${runId}: ${state.frontier.length} lead(s), ${state.budget.used}/${state.budget.maxHops} hops used`);

		return state;
	}

	const seed = await resolveSeedNode({ cwd, registry, edges, start });

	for (const note of seed.notes) {
		progress(note);
	}

	const hypothesis = suspectCommit ? `${symptoms} (suspect commit ${suspectCommit})` : symptoms;

	const state: DebugTraceState = {
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

	return state;
};
