import type { GateCommands } from '#src/gates/common/types/GateCommands.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';

interface Params {
	commands: GateCommands;
	label?: string;
	gate: RunGate;
	/** Stop at the first red (default); false runs every gate and aggregates the failures — verify's complete-report mode. */
	failFast?: boolean;
}

/** Run one group's gates in order: check → tests (coverage-instrumented when the set includes coverage) → build. First failure wins unless `failFast` is false, in which case every gate runs and failures aggregate. */
export const runGateSet = async ({ commands, label, gate, failFast = true }: Params): Promise<string | undefined> => {
	const group = label ?? 'root';
	const prefix = label ? `[${label}] ` : '';
	const failures: string[] = [];
	const stop = () => failFast && failures.length > 0;

	if (commands.check) {
		const check = await gate({ kind: 'check', command: commands.check, group });

		if (check.exitCode !== 0) {
			failures.push(`${prefix}check failed (exit ${check.exitCode}):\n${check.stdout}\n${check.stderr}`);
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
			failures.push(`${prefix}test-coverage failed (exit ${coverageResult.exitCode}):\n${coverageResult.stdout}\n${coverageResult.stderr}`);
		}
	} else if (!stop() && commands.test) {
		const tests = await gate({ kind: 'test', command: commands.test, group });

		if (tests.exitCode !== 0) {
			failures.push(`${prefix}test failed (exit ${tests.exitCode}):\n${tests.stdout}\n${tests.stderr}`);
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
			failures.push(`${prefix}${name} failed (exit ${extra.exitCode}):\n${extra.stdout}\n${extra.stderr}`);
		}
	}

	if (!stop() && commands.build) {
		const build = await gate({ kind: 'build', command: commands.build, group });

		if (build.exitCode !== 0) {
			failures.push(`${prefix}build failed (exit ${build.exitCode}):\n${build.stdout}\n${build.stderr}`);
		}
	}

	return failures.length > 0 ? failures.join('\n\n') : undefined;
};
