import { describeGateCoordinationStop } from '#src/common/utils/describeGateCoordinationStop.ts';
import { RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { takeGateHold } from '#src/gates/index.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { readBranchTicketRef } from '#src/ship/index.ts';

interface Params {
	run: PipelineRun;
	/** The verification step the coordination failure happened in. */
	stepId: string;
	record: StepRecord;
	/** The coordination reason `runGates` answered with — who holds the machine, in which worktree, and for how long it has held it. */
	coordination: string;
	/** Whatever gate output arrived beside it, kept as evidence a human reads. */
	error: string | undefined;
}

/**
 * End a verification step whose gates never started, because another gate run
 * of this repository held the machine for longer than the wait allows.
 *
 * Not one gate command executed, so the step holds no evidence about the code:
 * no fix attempt is spent, no fix agent is handed a tree nothing has judged, and
 * no supervisor is bought to rule on a run that never happened.
 *
 * It stops rather than passes because a checkpoint that never ran is not a green
 * one. What the operator is told is the difference: the machine is named, so the
 * answer reads as "the engine was waiting" rather than "your code is red" — and
 * the worktree and every commit in it are left exactly where they are, so the
 * work resumes from where it stopped once the machine is free.
 *
 * On ticket-backed work it also takes the durable hold, before it stops: without
 * one the next drain — or the next `lightsout resume` — picks the same ticket up
 * and queues behind the same busy machine again. A sentence the hold answers is
 * folded into the stop rather than swallowed, so a tracker that refused the
 * label is visible to whoever reads the run's ending. A branch carrying no
 * ticket takes no hold.
 */
export const stopOnGateCoordination = async ({ run, stepId, record, coordination, error }: Params): Promise<PipelineResult> => {
	run.progress(`step ${stepId}: the gates never started — another run holds this machine, and no fix was attempted`);

	const ticketRef = await readBranchTicketRef({ config: run.config, cwd: run.cwd });
	const holdFailure =
		ticketRef === undefined
			? undefined
			: await takeGateHold({
					cwd: run.cwd,
					config: run.config,
					ticketRef,
					runId: run.current().runId,
					worktreePath: run.cwd,
					reason: coordination,
					onProgress: (message) => run.progress(message),
				});

	return run.stop({
		record,
		status: RunStatus.Escalated,
		error: [describeGateCoordinationStop({ stepId, coordination }), error ?? '', ...(holdFailure === undefined ? [] : [holdFailure])].join('\n\n'),
	});
};
