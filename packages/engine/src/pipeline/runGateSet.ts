import type { GateCommands } from './common/types/GateCommands';
import type { RunGate } from './common/types/RunGate';

interface Params {
	commands: GateCommands;
	label?: string;
	gate: RunGate;
}

/** Run one group's gates in order: check → tests (coverage-instrumented when the set includes coverage) → build. First failure wins. */
export const runGateSet = async ({ commands, label, gate }: Params): Promise<string | undefined> => {
	const group = label ?? 'root';
	const prefix = label ? `[${label}] ` : '';

	if (commands.check) {
		const check = await gate({ kind: 'check', command: commands.check, group });

		if (check.exitCode !== 0) {
			return `${prefix}check failed (exit ${check.exitCode}):\n${check.stdout}\n${check.stderr}`;
		}
	}

	// Coverage REPLACES the plain test run when the set includes it: a
	// coverage command runs the same suites with instrumentation on (the
	// config contract requires it to run the unit tests), so running both is
	// the same fleet twice back-to-back. A red here is a test failure or an
	// unmet threshold — the output tells the fix agent which.
	if (commands.testCoverage) {
		const coverageResult = await gate({ kind: 'testCoverage', command: commands.testCoverage, group });

		if (coverageResult.exitCode !== 0) {
			return `${prefix}test-coverage failed (exit ${coverageResult.exitCode}):\n${coverageResult.stdout}\n${coverageResult.stderr}`;
		}
	} else if (commands.testUnit) {
		const tests = await gate({ kind: 'testUnit', command: commands.testUnit, group });

		if (tests.exitCode !== 0) {
			return `${prefix}test-unit failed (exit ${tests.exitCode}):\n${tests.stdout}\n${tests.stderr}`;
		}
	}

	if (commands.build) {
		const build = await gate({ kind: 'build', command: commands.build, group });

		if (build.exitCode !== 0) {
			return `${prefix}build failed (exit ${build.exitCode}):\n${build.stdout}\n${build.stderr}`;
		}
	}

	return undefined;
};
