import type { LightsoutConfig } from '@lightsout/contracts';
import { runCommand } from './runCommand';

const gateTimeoutMs = 10 * 60_000;

interface Params {
	cwd: string;
	config: LightsoutConfig;
}

/**
 * Run the consumer's verification gates (check, then unit tests). Returns a
 * combined error description on the first failure, or undefined when green —
 * exit codes are the only evidence accepted.
 */
export const runGates = async ({ cwd, config }: Params) => {
	const check = await runCommand({ command: config.scripts.check, cwd, timeoutMs: gateTimeoutMs });

	if (check.exitCode !== 0) {
		return `check failed (exit ${check.exitCode}):\n${check.stdout}\n${check.stderr}`;
	}

	const tests = await runCommand({ command: config.scripts.testUnit, cwd, timeoutMs: gateTimeoutMs });

	if (tests.exitCode !== 0) {
		return `test-unit failed (exit ${tests.exitCode}):\n${tests.stdout}\n${tests.stderr}`;
	}

	return undefined;
};
