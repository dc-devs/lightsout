import type { GateEntry } from '#src/gates/common/types/GateEntry.ts';
import type { GateOutcome } from '#src/gates/common/types/GateOutcome.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
import { describeGateCrash } from '#src/gates/common/utils/describeGateCrash.ts';

interface Params {
	/** The gates to run, in the order someone else already put them in — with every command final. */
	entries: GateEntry[];
	label?: string;
	gate: RunGate;
	/** Stop at the first red (default); false runs every gate and aggregates the failures — verify's complete-report mode. */
	failFast?: boolean;
}

/**
 * Run one ordered list of gates and report what happened.
 *
 * The order is not this function's to choose: `buildGateStages` decides which
 * gates a run schedules and in which order, because an override has to be able
 * to replace that decision entirely. What is left here is execution — first
 * failure wins unless `failFast` is false, in which case every gate in the list
 * runs and the failures aggregate.
 */
export const runGateSet = async ({ entries, label, gate, failFast = true }: Params): Promise<GateRunResult> => {
	const group = label ?? 'root';
	const prefix = label ? `[${label}] ` : '';
	const failures: string[] = [];
	const failedFamilies: string[] = [];
	const crashes: string[] = [];
	// A crash records a failure too, so it stops a fail-fast group like any red.
	const stop = () => failFast && failures.length > 0;

	// A red gate is recorded twice over: as output, which every caller reads as
	// the reason the run stopped, and as a family, which is what a fix agent is
	// asked to repair. A gate the runner judged a crash gets the first and not
	// the second — nothing is broken to repair, and the run still fails closed.
	const recordRed = ({ family, name, outcome }: { family: string; name: string; outcome: GateOutcome }) => {
		failures.push(`${prefix}${name} failed (exit ${outcome.exitCode}):\n${outcome.stdout}\n${outcome.stderr}`);

		if (outcome.crashed) {
			crashes.push(describeGateCrash({ label: `${prefix}${name}` }));
		} else {
			failedFamilies.push(family);
		}
	};

	for (const entry of entries) {
		if (stop()) {
			break;
		}

		const outcome = await gate({ kind: entry.family, command: entry.command, group });

		if (outcome.exitCode !== 0) {
			recordRed({ family: entry.family, name: entry.name, outcome });
		}
	}

	return {
		error: failures.length > 0 ? failures.join('\n\n') : undefined,
		failedFamilies: [...new Set(failedFamilies)],
		crashes,
	};
};
