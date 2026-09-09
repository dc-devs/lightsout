import { relative } from 'node:path';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import type { GateResult } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	kind: string;
	group: string;
	command: string;
	result: CommandResult;
	durationMs: number;
	crashed: boolean;
	rerun?: boolean;
	/** Absolute path of this execution's per-test evidence slot, recorded relative to the checkout. Absent for a run with no run folder. */
	evidenceDir?: string;
}

/**
 * One gate execution's evidence, in the single shape both sinks carry: the
 * commands.jsonl record adds only the log-specific `at`/`step` on top of it, so
 * building it twice is how the two would drift.
 */
export const buildGateResult = ({ cwd, kind, group, command, result, durationMs, crashed, rerun, evidenceDir }: Params): GateResult => {
	const outputTailChars = 2000;

	return {
		kind,
		group,
		command,
		exitCode: result.exitCode,
		durationMs,
		...(rerun ? { rerun: true } : {}),
		...(crashed ? { crashed: true } : {}),
		...(evidenceDir ? { testResultsDir: relative(cwd, evidenceDir) } : {}),
		...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-outputTailChars) }),
	};
};
