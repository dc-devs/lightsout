import { runCommand } from '#src/common/processes/runCommand.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import { appendCommandLog } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	config: LightsoutConfig;
	/** The step the run's command log attributes this formatter run to. */
	step: string;
	onResult?: (result: GateResult) => void;
}

/**
 * Run the consumer's configured formatter over the working tree, recorded in
 * the run's command log like any other command the engine spends.
 *
 * Every kind of run needs this and none of them agree on what a failure means —
 * the implement pipeline stops the run on one, a refactor batch announces it
 * and lets the gates decide — so this reports the failure and never throws or
 * halts. A repo with no formatter configured is not a failure; there is simply
 * nothing to run.
 */
export const runFormatter = async ({ cwd, runId, config, step, onResult }: Params): Promise<string | undefined> => {
	const command = config.gates.format;

	if (!command) {
		return undefined;
	}

	const formatTimeoutMs = 10 * 60_000;
	const startedAt = Date.now();
	let result: CommandResult;

	try {
		result = await runCommand({ command, cwd, timeoutMs: formatTimeoutMs });
	} catch (error) {
		// A formatter that times out or fails to spawn is a red result, not a crash.
		result = { exitCode: -1, stdout: '', stderr: messageOf({ error }) };
	}

	const gateResult: GateResult = {
		group: 'root',
		kind: 'format',
		command,
		exitCode: result.exitCode,
		durationMs: Date.now() - startedAt,
		...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-2000) }),
	};

	await appendCommandLog({
		cwd,
		runId,
		record: {
			at: new Date().toISOString(),
			step,
			...gateResult,
		},
	});
	onResult?.(gateResult);

	return result.exitCode === 0 ? undefined : `format failed (exit ${result.exitCode}):\n${result.stdout}\n${result.stderr}`;
};
