import { writeFileSync } from 'node:fs';
import { expect } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';

/** The absolute path the prompt names — the writer's output line and the repairer's plan-file bullet share the `- <path>` shape. */
const outputPathFrom = (prompt: string) => /- (\S+\.md)/.exec(prompt)?.[1];

/** The plan-writer's drafted report naming one written single-variant file. */
const draftedReport = ({ path }: { path: string }) =>
	JSON.stringify({
		status: 'drafted',
		filesWritten: [{ path, variant: 'single', scope: 'single' }],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: [],
	});

interface Params {
	/** The sequence of plan contents across successive calls — the last is reused when the loop runs longer. */
	bodies: string[];
	onCall?: (prompt: string) => void;
	onInvoke?: (invocation: DriverInvocation) => void;
	/** Repair override: does its own file edits and returns the PlanFixReport text, or a whole driver result. */
	repair?: ({ path }: { path: string }) => string | { text: string; exitCode: number; rateLimited?: boolean };
}

/**
 * A stub driver keyed off both plan-draft invocation markers. A `# Draft input`
 * prompt authors the next body to the output path and returns a
 * PlanDraftReport; a `# Repair input` prompt rewrites the plan file listed in
 * the prompt with the next body and returns a PlanFixReport — unless `repair`
 * overrides it.
 */
export const createDraftDriver = ({ bodies, onCall, onInvoke, repair }: Params): Driver => {
	let call = 0;

	return {
		name: 'stub',
		invoke: async (invocation) => {
			const { prompt } = invocation;

			onCall?.(prompt);
			onInvoke?.(invocation);

			const path = outputPathFrom(prompt);

			// plan path parsed from the prompt
			expectDefined(path);

			const body = bodies[Math.min(call, bodies.length - 1)];

			call += 1;

			if (prompt.includes('# Repair input')) {
				if (repair) {
					const outcome = repair({ path });

					return typeof outcome === 'string' ? { text: outcome, exitCode: 0 } : outcome;
				}

				writeFileSync(path, body);

				return {
					text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }),
					exitCode: 0,
				};
			}

			// plan-writer invocation marker present
			expect(prompt.includes('# Draft input')).toBeTruthy();
			writeFileSync(path, body);

			return { text: draftedReport({ path }), exitCode: 0 };
		},
	};
};
