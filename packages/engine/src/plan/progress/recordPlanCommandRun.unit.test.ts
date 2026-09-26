import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import { describe, expect, jest, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/buildActivityTree.ts';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { readActivityMarks } from '#src/activity/readActivityMarks.ts';
import type { ActivityLevelEnd } from '#src/contracts/activity/ActivityLevelEnd.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityLevelStart } from '#src/contracts/activity/ActivityLevelStart.ts';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { recordPlanCommandRun } from '#src/plan/progress/recordPlanCommandRun.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';

// No module mocks: the wrapper's whole job is marks in a plan folder's activity
// record, so each case arranges a real temporary checkout and reads the record
// back off disk.

/** What a subcommand's own work resolves to — its shape is the caller's business. */
interface WorkResult {
	converged: boolean;
}

const name = 'lo-150-planning-observability';

const isLevelStart = (mark: ActivityMark): mark is ActivityLevelStart => mark.kind === ActivityMarkKind.LevelStart;

const isLevelEnd = (mark: ActivityMark): mark is ActivityLevelEnd => mark.kind === ActivityMarkKind.LevelEnd;

const startOf = ({ marks, level }: { marks: ActivityMark[]; level: ActivityLevelKind }) => marks.filter(isLevelStart).find((mark) => mark.level === level);

/**
 * A temp checkout holding the plan folder, optionally with something squatting
 * where the record belongs — a directory on the record's own path, or a plain
 * file where the plan folder itself belongs, which is the harsher case where
 * not one line can be written — plus a work the wrapper hands the command run's
 * level to. Given `childLabel`, that work opens a child on the level it was
 * handed, which is how a test reads back which level the work actually got.
 */
const setupCommandRun = async ({
	recordPathTaken = false,
	planFolderTaken = false,
	childLabel,
	workError,
	workMs = 0,
	status = RunStatus.Passed,
}: {
	recordPathTaken?: boolean;
	planFolderTaken?: boolean;
	childLabel?: string;
	workError?: Error;
	workMs?: number;
	status?: RunStatus;
} = {}) => {
	const cwd = await freshCwd();
	const planDir = planWorkspaceFolder({ cwd: cwd, name: name });

	if (planFolderTaken) {
		await mkdir(dirname(planDir), { recursive: true });
		await writeFile(planDir, 'a file squatting where the plan folder belongs', 'utf8');
	} else {
		await mkdir(planDir, { recursive: true });
	}

	if (recordPathTaken) {
		await mkdir(join(planDir, 'activity.jsonl'), { recursive: true });
	}

	const workResult: WorkResult = { converged: true };
	const work = jest.fn<(params: { level: ActivityLevel | undefined }) => Promise<WorkResult>>(async ({ level }) => {
		if (childLabel !== undefined) {
			level?.open({ level: ActivityLevelKind.Pass, label: childLabel }).close({ outcome: RunStatus.Passed });
		}

		await new Promise((resolve) => {
			setTimeout(resolve, workMs);
		});

		if (workError) {
			throw workError;
		}

		return workResult;
	});
	const statusOf = jest.fn<(params: { result: WorkResult }) => RunStatus>().mockReturnValue(status);

	const errors: string[] = [];

	jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		errors.push(format(...args));
	});

	return { cwd, planDir, work, workResult, statusOf, errors };
};

/** Every file under `dir`, however deep — how a case states that nothing was written. */
const filesUnder = async ({ dir }: { dir: string }) => {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });

	return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
};

describe('recordPlanCommandRun', () => {
	test('a command run is recorded as a child of the plan level, both ended', async () => {
		const { cwd, planDir, work, workResult, statusOf } = await setupCommandRun({ status: RunStatus.PausedRateLimit });

		const result = await recordPlanCommandRun({ cwd, name, label: 'grade', work, statusOf });

		const marks = await readActivityMarks({ dir: planDir });
		const planStart = startOf({ marks, level: ActivityLevelKind.Plan });
		const runStart = startOf({ marks, level: ActivityLevelKind.CommandRun });
		const ends = marks.filter(isLevelEnd);

		expect(result).toBe(workResult);
		expect(statusOf).toHaveBeenCalledWith({ result: workResult });
		expect(planStart).toEqual(expect.objectContaining({ kind: 'level-start', level: 'plan', id: expect.any(String) }));
		expect(runStart).toEqual(expect.objectContaining({ kind: 'level-start', level: 'command-run', label: 'grade', parentId: planStart?.id }));
		expect(runStart?.parentId).toEqual(expect.any(String));
		expect(ends).toHaveLength(2);
		expect(ends).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: runStart?.id, outcome: 'paused-rate-limit', at: expect.any(String) }),
				expect.objectContaining({ id: planStart?.id, at: expect.any(String) }),
			]),
		);
	});

	test('work that throws still ends the command run, and rethrows', async () => {
		const workError = new Error('the drafting agent crashed');
		const { cwd, planDir, work, statusOf } = await setupCommandRun({ workError });

		await expect(recordPlanCommandRun({ cwd, name, label: 'draft', work, statusOf })).rejects.toBe(workError);

		const marks = await readActivityMarks({ dir: planDir });
		const runStart = startOf({ marks, level: ActivityLevelKind.CommandRun });
		const ends = marks.filter(isLevelEnd);

		expect(runStart).toEqual(expect.objectContaining({ level: 'command-run', label: 'draft', id: expect.any(String) }));
		expect(ends).toEqual(expect.arrayContaining([expect.objectContaining({ id: runStart?.id, outcome: 'failed' })]));
		expect(statusOf).not.toHaveBeenCalled();
	});

	test('two command runs in one folder fold into one plan row spanning both', async () => {
		const { cwd, planDir, work, statusOf } = await setupCommandRun({ workMs: 10 });

		await recordPlanCommandRun({ cwd, name, label: 'verify-facts', work, statusOf });
		await recordPlanCommandRun({ cwd, name, label: 'grade', work, statusOf });

		const report = buildActivityTree({ plan: name, marks: await readActivityMarks({ dir: planDir }) });
		const [root] = report.roots;
		const [firstRun, secondRun] = root?.children ?? [];

		expect(report.roots).toHaveLength(1);
		expect(root).toEqual(expect.objectContaining({ level: 'plan', startedAt: expect.any(String), endedAt: expect.any(String) }));
		expect(root?.children.map((child) => child.label)).toEqual(['verify-facts', 'grade']);
		expect(Date.parse(root?.startedAt ?? '')).toBeLessThanOrEqual(Date.parse(firstRun?.startedAt ?? ''));
		expect(Date.parse(root?.startedAt ?? '')).toBeLessThan(Date.parse(secondRun?.startedAt ?? ''));
		expect(Date.parse(root?.endedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(secondRun?.endedAt ?? ''));
	});

	test('an unwritable record is one stderr line, never a failed command', async () => {
		const { cwd, planDir, work, workResult, statusOf, errors } = await setupCommandRun({ recordPathTaken: true });

		const result = await recordPlanCommandRun({ cwd, name, label: 'publish', work, statusOf });

		expect(result).toBe(workResult);
		expect(work).toHaveBeenCalledTimes(1);
		expect(errors).toEqual(expect.arrayContaining([expect.stringContaining(planDir)]));
	});

	test('a plan folder no mark could be written into is one stderr line too', async () => {
		const { cwd, planDir, work, workResult, statusOf, errors } = await setupCommandRun({ planFolderTaken: true });

		const result = await recordPlanCommandRun({ cwd, name, label: 'dedup', work, statusOf });

		expect(result).toBe(workResult);
		expect(statusOf).toHaveBeenCalledWith({ result: workResult });
		expect(errors).toHaveLength(1);
		expect(errors[0]).toEqual(expect.stringContaining(join(planDir, 'activity.jsonl')));
	});

	test('the level handed to the work opens its children under the command run', async () => {
		const { cwd, planDir, work, statusOf } = await setupCommandRun({ childLabel: 'grading pass' });

		await recordPlanCommandRun({ cwd, name, label: 'grade', work, statusOf });

		const marks = await readActivityMarks({ dir: planDir });
		const runStart = startOf({ marks, level: ActivityLevelKind.CommandRun });
		const passStart = startOf({ marks, level: ActivityLevelKind.Pass });

		expect(passStart).toEqual(expect.objectContaining({ kind: 'level-start', level: 'pass', label: 'grading pass', parentId: runStart?.id }));
		expect(passStart?.parentId).toEqual(expect.any(String));
		expect(passStart?.parentId).not.toBe(name);
	});

	test('a command run with no plan name writes no record and hands the work no level', async () => {
		const { cwd, work, workResult, statusOf } = await setupCommandRun({ childLabel: 'a pass no level can open' });

		const result = await recordPlanCommandRun({ cwd, name: undefined, label: 'implement', work, statusOf });

		const files = await filesUnder({ dir: cwd });

		expect(result).toBe(workResult);
		expect(work).toHaveBeenCalledWith({ level: undefined });
		expect(statusOf).not.toHaveBeenCalled();
		expect(files).toEqual([]);
	});

	test('a command run with a plan name records the same marks it always has', async () => {
		const { cwd, planDir, work, workResult, statusOf } = await setupCommandRun({ childLabel: 'drafting pass' });

		const result = await recordPlanCommandRun({ cwd, name, label: 'draft', work, statusOf });

		const marks = await readActivityMarks({ dir: planDir });
		const planStart = startOf({ marks, level: ActivityLevelKind.Plan });
		const runStart = startOf({ marks, level: ActivityLevelKind.CommandRun });
		const passStart = startOf({ marks, level: ActivityLevelKind.Pass });
		const starts = marks.filter(isLevelStart);
		const ends = marks.filter(isLevelEnd);

		expect(result).toBe(workResult);
		expect(statusOf).toHaveBeenCalledWith({ result: workResult });
		// Exactly the three levels planning has always written — the wrapper's two
		// plus the one the work opened — and no mark of any other kind beside them.
		expect(marks).toHaveLength(6);
		expect(starts).toHaveLength(3);
		expect(ends).toHaveLength(3);
		expect(planStart).toEqual(expect.objectContaining({ kind: 'level-start', level: 'plan', label: name, id: name }));
		expect(runStart).toEqual(expect.objectContaining({ kind: 'level-start', level: 'command-run', label: 'draft', parentId: name }));
		expect(passStart).toEqual(expect.objectContaining({ kind: 'level-start', level: 'pass', label: 'drafting pass', parentId: runStart?.id }));
		expect(ends).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: name, outcome: 'passed' }), expect.objectContaining({ id: runStart?.id, outcome: 'passed' })]),
		);
	});
});
