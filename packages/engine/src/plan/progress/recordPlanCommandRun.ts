import { stat } from 'node:fs/promises';
import { activityRecordPath } from '#src/activity/activityRecordPath.ts';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { createActivityRecorder } from '#src/activity/createActivityRecorder.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params<Result> {
	cwd: string;
	/** A plan address or a legacy plan name — the folder the record is written in. Undefined when the caller has no plan folder, which records nothing. */
	name: string | undefined;
	/** What this command run is called in the report, e.g. the subcommand's own words. Free text: the recorder is handed a label, never a planning enum. */
	label: string;
	/** The subcommand's own work, handed the command-run level to open its children on — or undefined when nothing is being recorded. */
	work: ({ level }: { level: ActivityLevel | undefined }) => Promise<Result>;
	/** The outcome the command run's end mark carries, chosen by the caller to agree with the exit code it then returns. */
	statusOf: ({ result }: { result: Result }) => RunStatus;
}

/**
 * The sentence for a record that did not land, or nothing when it did.
 *
 * The recorder swallows its own write failures, because evidence must never
 * fail the work it describes, so looking afterwards is the only way this
 * wrapper can still tell a human. Every command run writes at least its own two
 * marks, so a record path that is not a file once they have settled is a record
 * nothing could be written to.
 */
const missingRecord = async ({ dir }: { dir: string }) => {
	const path = activityRecordPath({ dir });

	return stat(path)
		.then((found) => (found.isFile() ? undefined : `the activity record at ${path} could not be written: it is not a file`))
		.catch((error: unknown) => `the activity record at ${path} could not be written: ${messageOf({ error })}`);
};

/**
 * Run one plan subcommand's work with an open command-run level in hand, and
 * record it in the plan folder's activity record: the plan level, and this
 * command's own level beneath it, both closed on the way out whatever happened.
 *
 * It sits beside `recordPlanningStep` rather than extending it — that one keys
 * five named planning steps into `planning-progress.json`, which
 * `lightsout status --planning` reads live, while this one opens two levels of
 * a general append-only record under a free-text label. Three things are
 * borrowed from it deliberately, because the two wrappers nest and a reader has
 * to recognise the shape: the work is wrapped rather than instrumented from
 * outside, the end is written in a `finally` so a throw still closes the level
 * and rethrows, and a failed write is one stderr line rather than a failed plan
 * command.
 *
 * The plan level is closed on every command run rather than only on the last
 * one, because no process knows it is the last; the fold's earliest-start and
 * latest-end rules are what turn that into one correct plan span. And the
 * folder is resolved from `planWorkspaceDir` rather than from a path a caller
 * passes, so the record can only ever land in the main checkout.
 *
 * A caller with no plan name — an implement run pointed at a plan file outside
 * the plans directory — has no folder the record belongs in, so nothing is
 * resolved, nothing is written, and the work runs holding no level.
 */
export const recordPlanCommandRun = async <Result>({ cwd, name, label, work, statusOf }: Params<Result>): Promise<Result> => {
	if (name === undefined) {
		return work({ level: undefined });
	}

	const dir = await planWorkspaceDir({ cwd, name });
	const plan = createActivityRecorder({ dir, level: ActivityLevelKind.Plan, label: name });
	const commandRun = plan.open({ level: ActivityLevelKind.CommandRun, label });
	let outcome: RunStatus = RunStatus.Failed;

	try {
		const result = await work({ level: commandRun });

		outcome = statusOf({ result });

		return result;
	} finally {
		commandRun.close({ outcome });
		plan.close({ outcome });
		// Settled before this returns, so every mark is on disk before the caller
		// reaches `exitCli` — and so the check below reads a finished record.
		await plan.settled();

		const missing = await missingRecord({ dir });

		if (missing !== undefined) {
			console.error(missing);
		}
	}
};
