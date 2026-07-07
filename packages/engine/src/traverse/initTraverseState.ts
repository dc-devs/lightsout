import { readFile } from 'node:fs/promises';
import { type ConnectionDoc, TraceState } from '@lightsout/contracts';

const defaultBudget = 12;

interface Params {
	resumeRunId?: string;
	tracePath: string;
	edges: Map<string, ConnectionDoc>;
	start?: string;
	question: string;
	dataOfInterest?: string;
	budget?: number;
	runId: string;
	progress: (message: string) => void;
}

/**
 * Build the trace state a traverse run walks from: on resume, the saved trace
 * (with a fresh budget window when the prior run exhausted it); otherwise a
 * seed frontier from `--start` (an edge id, or a node's outbound edges).
 *
 * @throws {Error} when resuming without a saved trace, or when `--start` is
 * missing or names neither an edge nor a node with outbound edges.
 */
export const initTraverseState = async ({
	resumeRunId,
	tracePath,
	edges,
	start,
	question,
	dataOfInterest,
	budget,
	runId,
	progress,
}: Params): Promise<TraceState> => {
	if (resumeRunId) {
		const raw = await readFile(tracePath, 'utf8').catch(() => {
			throw new Error(`no trace found for run ${resumeRunId} at ${tracePath}`);
		});

		const state = TraceState.parse(JSON.parse(raw));

		// A budget-exhausted run resumes with a fresh window (that's what
		// resuming means for it); an explicit --budget sets the window size.
		if (state.budget.used >= state.budget.maxHops) {
			state.budget.maxHops = state.budget.used + (budget ?? state.budget.maxHops);
		}

		progress(`resuming run ${runId}: ${state.frontier.length} edge(s) on the frontier, ${state.budget.used}/${state.budget.maxHops} hops used`);

		return state;
	}

	if (!start) {
		throw new Error(`--start is required (an edge id or node name). Known edges: ${[...edges.keys()].join(', ') || 'none'}`);
	}

	const seeds = edges.has(start) ? [start] : [...edges.entries()].filter(([, doc]) => doc.from === start).map(([id]) => id);

	if (seeds.length === 0) {
		throw new Error(`'${start}' is neither an edge id nor a node with outbound edges. Known edges: ${[...edges.keys()].join(', ') || 'none'}`);
	}

	const state: TraceState = {
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

	return state;
};
