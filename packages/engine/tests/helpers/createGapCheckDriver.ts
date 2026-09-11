import { expect } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';

interface Params {
	/** The gap set every checker in the fan-out returns. */
	gaps?: unknown[];
	/** The ruling a judge gives each observation its batch holds, as a single-observation ruling. An `answerAt` is cited at every plan file the batch spans. */
	verdict?: Record<string, unknown>;
	/** The gap set the whole-plan documentation checker returns. Only a repo declaring a `docs` block ever spawns it. */
	docsGaps?: unknown[];
	/** The answer every re-verification judge gives for the open records the memory holds. The default leaves each one open. */
	recheckVerdict?: unknown;
	/** Collector the stub pushes every invocation it is handed into. */
	invocations?: DriverInvocation[];
}

/**
 * A batch judge's answer that rules on every observation its prompt names with
 * the same single-observation ruling — so no two findings are ever confirmed as
 * one defect, and each is weighed exactly as it would be alone.
 */
const rulePerObservation = ({ prompt, verdict }: { prompt: string; verdict: Record<string, unknown> }) => {
	const ids = [...prompt.matchAll(/^### (o\d+)$/gm)].map(([, id]) => id);
	const phases = [...prompt.matchAll(/^## Plan file: (.+)$/gm)].map(([, phase]) => phase);
	const { answerAt, ...ruling } = verdict;
	const answers = typeof answerAt === 'string' ? phases.map((phase) => ({ phase, answerAt })) : [];

	return { verdicts: ids.map((id) => ({ ...ruling, covers: [id], answers })) };
};

/**
 * A grade-pass stub keyed off the four markers a grade run spawns with: a
 * gap-check invocation gets the fixed gap set, a gap-judge invocation gets one
 * ruling per observation, a docs-check invocation gets its own gap set, and a
 * finding-recheck invocation gets one re-verification answer. The default
 * rulings are `needs-a-human`, so a gap-returning stub still fails a plan the way
 * it always did and an open record stays open.
 */
export const createGapCheckDriver = ({
	gaps = [],
	verdict = { outcome: 'needs-a-human', humanDecision: 'what the plan should do here' },
	docsGaps = [],
	recheckVerdict = { outcome: 'needs-a-human', humanDecision: 'still open' },
	invocations = [],
}: Params = {}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		const judging = invocation.prompt.includes('# Gap-judge input');
		const checkingDocs = invocation.prompt.includes('# Docs-check input');
		const rechecking = invocation.prompt.includes('# Finding-recheck input');

		// One of the four markers — a grade run spawns nothing else through this
		// driver, so an invocation carrying none is a wiring bug worth failing on.
		expect(judging || checkingDocs || rechecking || invocation.prompt.includes('# Gap-check input')).toBeTruthy();

		if (judging) {
			return { text: JSON.stringify(rulePerObservation({ prompt: invocation.prompt, verdict })), exitCode: 0 };
		}

		if (rechecking) {
			return { text: JSON.stringify(recheckVerdict), exitCode: 0 };
		}

		return { text: JSON.stringify({ gaps: checkingDocs ? docsGaps : gaps }), exitCode: 0 };
	},
});
