import { messageOf } from '#src/common/utils/messageOf.ts';
import { type PlanningProgress, PlanningStep, type PlanningStepRecord, RunStatus } from '#src/contracts/index.ts';
import { writePlanningProgress } from '#src/plan/progress/common/utils/writePlanningProgress.ts';
import { getPlanningProgressPath } from '#src/plan/progress/getPlanningProgressPath.ts';
import { readPlanningProgress } from '#src/plan/progress/readPlanningProgress.ts';

/** Every other step's entry kept as it was, this step's replaced, and the whole list in `PlanningStep` order. */
const withEntry = ({ progress, entry }: { progress: PlanningProgress | undefined; entry: PlanningStepRecord }) => {
	const order = Object.values(PlanningStep);
	const others = progress?.steps.filter((candidate) => candidate.step !== entry.step) ?? [];

	return [...others, entry].sort((left, right) => order.indexOf(left.step) - order.indexOf(right.step));
};

/**
 * Read the record again, rewrite it whole with this step's entry, and answer
 * the entry. A failed write is one stderr line and nothing more: the record is
 * a reader's convenience, and the planning work it describes must not fail
 * because of it.
 */
const recordEntry = async ({
	cwd,
	name,
	step,
	entryOf,
}: {
	cwd: string;
	name: string;
	step: PlanningStep;
	entryOf: ({ previous }: { previous: PlanningStepRecord | undefined }) => PlanningStepRecord;
}) => {
	const current = await readPlanningProgress({ cwd, name });
	const entry = entryOf({ previous: current?.steps.find((candidate) => candidate.step === step) });
	const progress: PlanningProgress = { name, updatedAt: new Date().toISOString(), steps: withEntry({ progress: current, entry }) };

	await writePlanningProgress({ cwd, progress }).catch((error: unknown) => {
		console.error(`the planning progress record at ${getPlanningProgressPath({ cwd, name })} could not be written: ${messageOf({ error })}`);
	});

	return entry;
};

interface Params<Result> {
	cwd: string;
	name: string;
	step: PlanningStep;
	/** The subcommand's own work — the runner call it already makes. */
	work: () => Promise<Result>;
	/** The status the finished step records, chosen by the caller to agree with the exit code it then returns. */
	statusOf: ({ result }: { result: Result }) => RunStatus;
}

/**
 * Run one plan subcommand's work and record it in the plan folder's planning
 * record: as running before the work starts, and as `statusOf` says once it
 * settles — or as failed when it throws, with the same error rethrown.
 *
 * The finish is awaited before this settles, so the record lands before the
 * caller reaches `exitCli`. Each write checks the plan folder on its own, so a
 * work that creates the folder still gets its finish written. There is no
 * lock: plan subcommands on one plan folder run one at a time, and a lock would
 * add a failure path to planning work for a record only a reader uses.
 */
export const recordPlanningStep = async <Result>({ cwd, name, step, work, statusOf }: Params<Result>): Promise<Result> => {
	const started = await recordEntry({
		cwd,
		name,
		step,
		entryOf: ({ previous }) => ({
			step,
			status: RunStatus.Running,
			attempts: (previous?.attempts ?? 0) + 1,
			pid: process.pid,
			startedAt: new Date().toISOString(),
		}),
	});
	let status: RunStatus = RunStatus.Failed;

	try {
		const result = await work();

		status = statusOf({ result });

		return result;
	} finally {
		const finishedAt = new Date();

		await recordEntry({
			cwd,
			name,
			step,
			entryOf: () => ({
				...started,
				status,
				finishedAt: finishedAt.toISOString(),
				durationMs: Math.max(0, finishedAt.getTime() - Date.parse(started.startedAt)),
			}),
		});
	}
};
