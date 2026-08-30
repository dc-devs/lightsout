import { expect } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';

interface Params {
	/** The gap set every checker in the fan-out returns. */
	gaps?: unknown[];
	/** The ruling every judge returns for the findings those checkers reported. */
	verdict?: unknown;
	/** The gap set the whole-plan documentation checker returns. Only a repo declaring a `docs` block ever spawns it. */
	docsGaps?: unknown[];
	/** Collector the stub pushes every invocation it is handed into. */
	invocations?: DriverInvocation[];
}

/**
 * A grade-pass stub keyed off the three markers a grade run spawns with: a
 * gap-check invocation gets the fixed gap set, a gap-judge invocation gets one
 * verdict, and a docs-check invocation gets its own gap set. The default ruling
 * is `needs-a-human`, so a gap-returning stub still fails a plan the way it
 * always did.
 */
export const createGapCheckDriver = ({
	gaps = [],
	verdict = { outcome: 'needs-a-human', humanDecision: 'what the plan should do here' },
	docsGaps = [],
	invocations = [],
}: Params = {}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		const judging = invocation.prompt.includes('# Gap-judge input');
		const checkingDocs = invocation.prompt.includes('# Docs-check input');

		// One of the three markers — a grade run spawns nothing else through this
		// driver, so an invocation carrying none is a wiring bug worth failing on.
		expect(judging || checkingDocs || invocation.prompt.includes('# Gap-check input')).toBeTruthy();

		if (judging) {
			return { text: JSON.stringify(verdict), exitCode: 0 };
		}

		return { text: JSON.stringify({ gaps: checkingDocs ? docsGaps : gaps }), exitCode: 0 };
	},
});
