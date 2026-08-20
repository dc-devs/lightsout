import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { runCommand } from '#src/common/utils/runCommand.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { appendCommandLog } from '#src/runState/index.ts';

interface Params {
	run: PipelineRun;
}

/** The formatter step: behavior-preserving by contract — verified anyway; a red gate here is a human's configuration problem, not an agent's. */
export const formatStep = ({ run }: Params): PipelineStep => ({
	id: 'format',
	skip: () => (run.config.gates.format ? undefined : 'no format command configured'),
	run: async () => {
		const formatCommand = run.config.gates.format;

		if (!formatCommand) {
			return undefined;
		}

		const record = run.nextRecord({ id: 'format' });

		await run.setStep({ record });
		run.progress('step format — running formatter');

		const formatTimeoutMs = 10 * 60_000;
		const startedAt = Date.now();
		let result: CommandResult;

		try {
			result = await runCommand({ command: formatCommand, cwd: run.cwd, timeoutMs: formatTimeoutMs });
		} catch (error) {
			// A formatter that times out or fails to spawn is a red step, not a crash.
			result = { exitCode: -1, stdout: '', stderr: messageOf({ error }) };
		}

		await appendCommandLog({
			cwd: run.cwd,
			runId: run.current().runId,
			record: {
				at: new Date().toISOString(),
				step: 'format',
				group: 'root',
				kind: 'format',
				command: formatCommand,
				exitCode: result.exitCode,
				durationMs: Date.now() - startedAt,
				...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-2000) }),
			},
		});

		if (result.exitCode !== 0) {
			return run.stop({
				record,
				status: RunStatus.Failed,
				error: `format failed (exit ${result.exitCode}):\n${result.stdout}\n${result.stderr}`,
			});
		}

		const error = await runVerificationGates({ run, coverage: true });

		if (error) {
			return run.stop({
				record,
				status: RunStatus.Failed,
				error: `format: formatting broke verification — review the formatter/gate configuration.\n${error}`,
			});
		}

		// No changed-file merge here: the formatter only rewrites files the
		// run already tracks, and anything new it emits is artifact noise.
		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
		run.progress('step format passed');

		return undefined;
	},
});
