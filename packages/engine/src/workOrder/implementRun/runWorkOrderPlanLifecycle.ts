import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { PlanProgress, RunStatus, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { durablePlanFiles } from '#src/plan/index.ts';
import type { WorkOrderPlanOutcome } from '#src/workOrder/common/types/WorkOrderPlanOutcome.ts';
import { findDivergentPlanIds } from '#src/workOrder/common/utils/findDivergentPlanIds.ts';
import { isWholePlanRun } from '#src/workOrder/common/utils/isWholePlanRun.ts';
import { readWorkOrderSyncState } from '#src/workOrder/common/utils/readWorkOrderSyncState.ts';
import { findPlanImplementationBlocker } from '#src/workOrder/findPlanImplementationBlocker.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';

interface Params {
	/** The checkout the run builds in: HEAD is read and the plan's durable files are hashed here; the record is resolved through its primary checkout. */
	cwd: string;
	/** The plan's name under the plans directory: a plan address, a legacy folder name, or undefined. */
	name: string | undefined;
	/** The id of the run a resume continues. Absent for a fresh run, which is handed a newly minted id. */
	resumeRunId?: string;
	/** Runs the pipeline. A fresh run must be created under exactly the id it is handed. */
	run: (params: { runId: string }) => Promise<PipelineResult>;
}

/** Every durable file of the plan, with the hash of the bytes on disk — the scope a passed run is recorded against. */
const readPlanSnapshot = async ({ cwd, name }: { cwd: string; name: string }) => {
	const durable = await durablePlanFiles({ cwd, name });
	const snapshot: { name: string; sha256: string }[] = [];

	for (const file of durable.files) {
		const content = await readFile(file.path).catch(() => undefined);

		if (content !== undefined) {
			snapshot.push({ name: file.name, sha256: sha256({ content }) });
		}
	}

	return snapshot;
};

/** The same record with one plan replaced, which is the only shape of change this helper ever makes. */
const withPlan = ({ record, plan }: { record: WorkOrderState; plan: WorkOrderPlan }): WorkOrderState => ({
	...record,
	plans: record.plans.map((candidate) => (candidate.id === plan.id ? plan : candidate)),
});

/**
 * Mark the plan implementing, re-asking the order rules against the record as it
 * stands inside the lock.
 *
 * The re-ask is the point: minutes may pass between the first read and this
 * write, and a record another command changed meanwhile must not be overwritten
 * with a decision taken against the old one.
 */
const recordImplementing = ({
	cwd,
	workOrderName,
	planId,
	runId,
	headCommit,
}: {
	cwd: string;
	workOrderName: string;
	planId: string;
	runId: string;
	headCommit: string | undefined;
}) =>
	updateLocalWorkOrderState({
		cwd,
		name: workOrderName,
		change: (current) => {
			if (current === undefined) {
				return { error: `work order ${workOrderName} no longer has a record, so plan ${planId} cannot be recorded as being implemented` };
			}

			const blocker = findPlanImplementationBlocker({ record: current, planId });

			if (blocker !== undefined) {
				return { error: blocker };
			}

			const plan = current.plans.find((candidate) => candidate.id === planId);

			if (plan === undefined) {
				return { error: `work order ${workOrderName} holds no plan ${planId}` };
			}

			// Where the implementation BEGAN, kept across every repair of it: a plan
			// already implementing or failed keeps the start its first run recorded.
			const started =
				(plan.progress === PlanProgress.Implementing || plan.progress === PlanProgress.Failed) && plan.implementation !== undefined
					? { startedAt: plan.implementation.startedAt, startCommit: plan.implementation.startCommit }
					: { startedAt: new Date().toISOString(), startCommit: headCommit ?? '' };

			return withPlan({ record: current, plan: { ...plan, progress: PlanProgress.Implementing, implementation: { runId, ...started } } });
		},
	});

/** Whether the plan's start values have to be minted, which is the only case that needs git to name a commit. */
const needsFreshStart = ({ plan }: { plan: WorkOrderPlan | undefined }) =>
	plan?.implementation === undefined || (plan.progress !== PlanProgress.Implementing && plan.progress !== PlanProgress.Failed);

/** What the finished run leaves on the plan: implemented with its scope, failed, or the progress the run started under. */
const recordOutcome = async ({
	cwd,
	workOrderName,
	planId,
	name,
	result,
}: {
	cwd: string;
	workOrderName: string;
	planId: string;
	name: string;
	result: PipelineResult;
}) => {
	const whole = await isWholePlanRun({ cwd, name, planPath: result.manifest.plan, pipeline: result.manifest.pipeline });
	const failed = result.manifest.status === RunStatus.Failed || result.manifest.status === RunStatus.Escalated;

	// A pass that covered one phase, and a pause, both leave the plan exactly as
	// the pre-run write left it: implementing, under this run's id.
	if (!(result.ok && whole) && !failed) {
		return undefined;
	}

	const snapshot = result.ok ? await readPlanSnapshot({ cwd, name }) : undefined;
	const finishedAt = new Date().toISOString();
	const updated = await updateLocalWorkOrderState({
		cwd,
		name: workOrderName,
		change: (current) => {
			const plan = current?.plans.find((candidate) => candidate.id === planId);

			if (current === undefined || plan === undefined) {
				return { error: `work order ${workOrderName} no longer holds plan ${planId}, so the run's outcome could not be recorded against it` };
			}

			const implementation = plan.implementation ?? { runId: result.manifest.runId, startedAt: finishedAt, startCommit: '' };

			return withPlan({
				record: current,
				plan:
					snapshot === undefined
						? { ...plan, progress: PlanProgress.Failed, implementation }
						: { ...plan, progress: PlanProgress.Implemented, implementation: { ...implementation, finishedAt, snapshot } },
			});
		},
	});

	return 'error' in updated ? updated.error : undefined;
};

/**
 * Wrap one pipeline run for a plan name: refuse a plan the work order state says
 * may not be built, record the plan's progress around the run, and run the
 * pipeline unchanged for a legacy folder name or a ticket with no record.
 *
 * `implement`, `resume` and the queue's plan build all go through here, so the
 * ticket's numeric order, its mode and its exclusions are enforced on every path
 * rather than only in the queue. A refusal is one sentence returned, never
 * thrown or printed: the caller owns the exit code, exactly as
 * `requireImplementLifecycle` leaves it.
 *
 * Every write is local. Progress is this machine's working state, and the next
 * `lightsout work-order` subcommand or `plan publish` is what puts it on the ticket.
 *
 * A pipeline that throws, or exits before its run exists, deliberately leaves
 * the plan `implementing` under an id no manifest carries: the next `implement`
 * or `resume` of the plan overwrites the id and keeps the start, and restoring
 * the old progress would have to happen outside the fail-fast wrappers that call
 * `process.exit` around this function.
 *
 * @returns the refusal, or the run's result with a record-write failure and a whole-plan note beside it
 */
export const runWorkOrderPlanLifecycle = async ({ cwd, name, resumeRunId, run }: Params): Promise<WorkOrderPlanOutcome> => {
	const address = name === undefined ? undefined : parsePlanAddress({ name });

	if (name === undefined || address === undefined) {
		return { result: await run({ runId: resumeRunId ?? randomUUID() }) };
	}

	const { workOrderName, planId } = address;
	const read = await readWorkOrderState({ cwd, name: workOrderName });

	if ('error' in read) {
		return { refusal: read.error };
	}

	const { record } = read;

	if (record === undefined) {
		return { result: await run({ runId: resumeRunId ?? randomUUID() }) };
	}

	const blocker = findPlanImplementationBlocker({ record, planId });

	if (blocker !== undefined) {
		return { refusal: blocker };
	}

	const syncState = await readWorkOrderSyncState({ workOrderFolder: await workOrderFolderDir({ cwd, name: workOrderName }) });

	if (findDivergentPlanIds({ record, syncState }).includes(planId)) {
		return {
			refusal: `plan ${planId} was published from another machine after this one last saw it, so the copy here may not be what the ticket carries — run \`lightsout work-order sync --name ${workOrderName} --keep published\` to take the ticket's copy, or \`--keep local\` to publish this machine's over it`,
		};
	}

	const plan = record.plans.find((candidate) => candidate.id === planId);
	const fresh = needsFreshStart({ plan });
	const headCommit = fresh ? await readGitHeadCommit({ cwd }) : undefined;

	if (fresh && headCommit === undefined) {
		return {
			refusal: `git could not name the commit ${cwd} is standing on, and the implementation of plan ${planId} on work order ${workOrderName} is recorded against the commit it starts from`,
		};
	}

	const runId = resumeRunId ?? randomUUID();
	const started = await recordImplementing({ cwd, workOrderName, planId, runId, headCommit });

	if ('error' in started) {
		return { refusal: started.error };
	}

	const result = await run({ runId });
	const recordError = await recordOutcome({ cwd, workOrderName, planId, name, result });
	const note =
		result.ok && !(await isWholePlanRun({ cwd, name, planPath: result.manifest.plan, pipeline: result.manifest.pipeline }))
			? `this run covered one phase file of plan ${planId} and it passed; the implementation of plan ${planId} on work order ${workOrderName} has not finished until the whole plan runs`
			: undefined;

	return { result, recordError, note };
};
