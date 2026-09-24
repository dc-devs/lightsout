import { randomUUID } from 'node:crypto';
import { PlanProgress, RunStatus, type WorkOrderState } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import type { WorkOrderPlanOutcome } from '#src/workOrder/common/types/WorkOrderPlanOutcome.ts';
import { isPlanlessWorkOrder } from '#src/workOrder/isPlanlessWorkOrder.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';

interface Params {
	/** The checkout the build runs in; the record is resolved through its primary checkout. */
	cwd: string;
	/** The work order's label — the folder its record sits in. */
	workOrderName: string;
	/** Runs the build. A fresh run must be created under exactly the id it is handed. */
	run: (params: { runId: string }) => Promise<PipelineResult>;
}

type TicketBodyBuild = NonNullable<WorkOrderState['ticketBodyBuild']>;

/**
 * Mark the build implementing, re-asking whether the record is still plan-less
 * as it stands inside the lock.
 *
 * The re-ask is the point, as it is for a plan: a record another command changed
 * since the first read — one that gained plan 001 — must not be given a build
 * from the ticket body that no ship rule would read.
 */
const recordImplementing = ({ cwd, workOrderName, build }: { cwd: string; workOrderName: string; build: TicketBodyBuild }) =>
	updateLocalWorkOrderState({
		cwd,
		name: workOrderName,
		change: (current) => {
			if (current === undefined) {
				return { error: `work order ${workOrderName} no longer has a record, so its build from the ticket body cannot be recorded as being implemented` };
			}

			if (!isPlanlessWorkOrder({ record: current })) {
				return {
					error: `work order ${workOrderName} is no longer a single-plan work order holding no plan 001, so it is not built from the ticket body — build it through its plans instead`,
				};
			}

			return { ...current, ticketBodyBuild: build };
		},
	});

/** What the finished run leaves on the record: implemented, failed, or — after a pause — the implementing mark the run started under. */
const recordOutcome = async ({ cwd, workOrderName, build, result }: { cwd: string; workOrderName: string; build: TicketBodyBuild; result: PipelineResult }) => {
	const failed = result.manifest.status === RunStatus.Failed || result.manifest.status === RunStatus.Escalated;

	if (!result.ok && !failed) {
		return undefined;
	}

	const progress = result.ok ? PlanProgress.Implemented : PlanProgress.Failed;
	const finishedAt = new Date().toISOString();
	const updated = await updateLocalWorkOrderState({
		cwd,
		name: workOrderName,
		change: (current) =>
			current === undefined
				? { error: `work order ${workOrderName} no longer has a record, so the outcome of its build from the ticket body could not be recorded on it` }
				: { ...current, ticketBodyBuild: { ...build, progress, finishedAt } },
	});

	return 'error' in updated ? updated.error : undefined;
};

/**
 * Wrap one build from the ticket body and record it on the work order record as
 * `ticketBodyBuild`, for a single-plan work order holding no plan 001 — the
 * build the single-plan ship check reads when there is no plan 001 to read.
 *
 * Both queue workers that build from the ticket body go through here: the direct
 * worker and the plan worker's plan-less path. With no record, or a record that
 * is not plan-less, the build runs unchanged and nothing is written, because no
 * ship rule would read it there.
 *
 * Each build replaces the field whole: a new run id, a new start, and no finish
 * until the run ends. A pause leaves it implementing. Every write is local, as
 * plan progress is, and publishing stays with the commands that already publish
 * the record. A refusal is one sentence returned, and a record write that fails
 * after the run is returned beside the result — never thrown or printed.
 *
 * @returns the refusal, or the run's result with a record-write failure beside it
 */
export const runWorkOrderBodyBuildLifecycle = async ({ cwd, workOrderName, run }: Params): Promise<WorkOrderPlanOutcome> => {
	const read = await readWorkOrderState({ cwd, name: workOrderName });

	if ('error' in read) {
		return { refusal: read.error };
	}

	const { record } = read;

	if (record === undefined || !isPlanlessWorkOrder({ record })) {
		return { result: await run({ runId: randomUUID() }) };
	}

	const build: TicketBodyBuild = { runId: randomUUID(), progress: PlanProgress.Implementing, startedAt: new Date().toISOString() };
	const started = await recordImplementing({ cwd, workOrderName, build });

	if ('error' in started) {
		return { refusal: started.error };
	}

	const result = await run({ runId: build.runId });
	const recordError = await recordOutcome({ cwd, workOrderName, build, result });

	return recordError === undefined ? { result } : { result, recordError };
};
