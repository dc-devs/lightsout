import { RunStatus } from '@lightsout/contracts';
import { runCommand } from '../../common/utils/runCommand';
import { appendCommandLog } from '../../runState';
import type { PipelineRun } from '../PipelineRun';
import type { PipelineStep } from '../PipelineStep';
import { gates } from '../common/utils/gates';

const formatTimeoutMs = 10 * 60_000;

interface Params {
	run: PipelineRun;
}

/** The formatter step: behavior-preserving by contract — verified anyway; a red gate here is a human's configuration problem, not an agent's. */
export const formatStep = ({ run }: Params): PipelineStep => ({
	id: 'format',
	skip: () => (run.config.scripts.format ? undefined : 'no format command configured'),
	run: async () => {
		const formatCommand = run.config.scripts.format;

		if (!formatCommand) {
			return undefined;
		}

		const record = run.nextRecord({ id: 'format' });

		await run.setStep({ record });
		run.progress('step format — running formatter');

		const startedAt = Date.now();
		let result;

		try {
			result = await runCommand({ command: formatCommand, cwd: run.cwd, timeoutMs: formatTimeoutMs });
		} catch (error) {
			// A formatter that times out or fails to spawn is a red step, not a crash.
			result = { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
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

		const error = await gates({ run, coverage: true });

		if (error) {
			return run.stop({ record, status: RunStatus.Failed, error: `format: formatting broke verification — review the formatter/gate configuration.\n${error}` });
		}

		// No changed-file merge here: the formatter only rewrites files the
		// run already tracks, and anything new it emits is artifact noise.
		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
		run.progress('step format passed');

		return undefined;
	},
});
