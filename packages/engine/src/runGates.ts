import type { LightsoutConfig } from '@lightsout/contracts';
import { runCommand } from './runCommand';

const gateTimeoutMs = 10 * 60_000;

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/**
	 * Also run the coverage gate. On at clean-slate and every verify AFTER
	 * tests exist; off for verify-implement, where freshly written source has
	 * no tests yet and a coverage failure would not be the agent's fault.
	 */
	coverage?: boolean;
}

/**
 * Run the consumer's verification gates in order: check → unit tests →
 * coverage (when requested and configured) → build (opt-in). Returns a
 * combined error description on the first failure, or undefined when green —
 * exit codes are the only evidence accepted.
 */
export const runGates = async ({ cwd, config, coverage }: Params) => {
	const check = await runCommand({ command: config.scripts.check, cwd, timeoutMs: gateTimeoutMs });

	if (check.exitCode !== 0) {
		return `check failed (exit ${check.exitCode}):\n${check.stdout}\n${check.stderr}`;
	}

	const tests = await runCommand({ command: config.scripts.testUnit, cwd, timeoutMs: gateTimeoutMs });

	if (tests.exitCode !== 0) {
		return `test-unit failed (exit ${tests.exitCode}):\n${tests.stdout}\n${tests.stderr}`;
	}

	if (coverage && typeof config.scripts.testCoverage === 'string') {
		const coverageResult = await runCommand({ command: config.scripts.testCoverage, cwd, timeoutMs: gateTimeoutMs });

		if (coverageResult.exitCode !== 0) {
			return `test-coverage failed (exit ${coverageResult.exitCode}):\n${coverageResult.stdout}\n${coverageResult.stderr}`;
		}
	}

	if (config.scripts.build) {
		const build = await runCommand({ command: config.scripts.build, cwd, timeoutMs: gateTimeoutMs });

		if (build.exitCode !== 0) {
			return `build failed (exit ${build.exitCode}):\n${build.stdout}\n${build.stderr}`;
		}
	}

	return undefined;
};
