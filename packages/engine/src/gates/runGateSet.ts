import type { GateCommands } from '#src/gates/common/types/GateCommands.ts';
import type { GateOutcome } from '#src/gates/common/types/GateOutcome.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
import { describeGateCrash } from '#src/gates/common/utils/describeGateCrash.ts';

interface Params {
	commands: GateCommands;
	label?: string;
	gate: RunGate;
	/** Stop at the first red (default); false runs every gate and aggregates the failures — verify's complete-report mode. */
	failFast?: boolean;
}

/** Run one group's gates in order: check → tests (coverage-instrumented when the set includes coverage) → build. First failure wins unless `failFast` is false, in which case every gate runs and failures aggregate. */
export const runGateSet = async ({ commands, label, gate, failFast = true }: Params): Promise<GateRunResult> => {
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

	if (commands.check) {
		const check = await gate({ kind: 'check', command: commands.check, group });

		if (check.exitCode !== 0) {
			recordRed({ family: 'check', name: 'check', outcome: check });
		}
	}

	// Coverage REPLACES the plain test run when the set includes it: a
	// coverage command runs the same suites with instrumentation on (the
	// config contract requires it to run the tests), so running both is
	// the same fleet twice back-to-back. A red here is a test failure or an
	// unmet threshold — the output tells the fix agent which.
	if (!stop() && commands.testCoverage) {
		const coverageResult = await gate({ kind: 'testCoverage', command: commands.testCoverage, group });

		if (coverageResult.exitCode !== 0) {
			recordRed({ family: 'testCoverage', name: 'test-coverage', outcome: coverageResult });
		}
	} else if (!stop() && commands.test) {
		const tests = await gate({ kind: 'test', command: commands.test, group });

		if (tests.exitCode !== 0) {
			recordRed({ family: 'test', name: 'test', outcome: tests });
		}
	}

	// Custom `test-*` suites are their own gates — never substituted by
	// coverage, run in the order the config wrote them, after the unit suite
	// and before build so the cheap gates keep their chance to fail first.
	for (const { name, command } of commands.extraTests ?? []) {
		if (stop() || !command) {
			continue;
		}

		const extra = await gate({ kind: name, command, group });

		if (extra.exitCode !== 0) {
			recordRed({ family: name, name, outcome: extra });
		}
	}

	if (!stop() && commands.build) {
		const build = await gate({ kind: 'build', command: commands.build, group });

		if (build.exitCode !== 0) {
			recordRed({ family: 'build', name: 'build', outcome: build });
		}
	}

	return {
		error: failures.length > 0 ? failures.join('\n\n') : undefined,
		failedFamilies: [...new Set(failedFamilies)],
		crashes,
	};
};
