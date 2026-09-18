import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { createActivityRecorder } from '#src/activity/index.ts';
import { ActivityLevelKind, ProcessEndReason, RunStatus } from '#src/contracts/index.ts';

const setupRecorder = ({ label = 'my-plan', blocked = false }: { label?: string; blocked?: boolean } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-activity-'));
	const path = join(dir, 'activity.jsonl');

	// A record path that is a directory is the cheapest real append failure:
	// every write to it rejects, which is what the swallow has to survive.
	if (blocked) {
		mkdirSync(path);
	}

	const open = () => createActivityRecorder({ dir, level: ActivityLevelKind.Plan, label });

	return { dir, open, path };
};

const readMarks = ({ path }: { path: string }): Record<string, unknown>[] =>
	readFileSync(path, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);

describe('createActivityRecorder', () => {
	test('marks land in call order with each child naming its parent', async () => {
		const { open, path } = setupRecorder();

		const plan = open();
		const step = plan.open({ level: ActivityLevelKind.Step, label: 'draft' });
		step.recordProcess({
			harness: 'claude-code',
			spawn: 1,
			reemit: false,
			startedAt: '2026-09-17T10:00:00.000Z',
			endedAt: '2026-09-17T10:01:00.000Z',
			endReason: ProcessEndReason.Completed,
		});
		step.close({ outcome: RunStatus.Passed });
		plan.close({ outcome: RunStatus.Passed });
		await plan.settled();

		const marks = readMarks({ path });

		// One line per call, in call order: the appends are chained through one
		// queue, so a nested level can never land before the level it opened in.
		expect(marks).toEqual([
			expect.objectContaining({ kind: 'level-start', id: plan.id, label: 'my-plan' }),
			expect.objectContaining({ kind: 'level-start', id: step.id, parentId: plan.id, label: 'draft' }),
			expect.objectContaining({ kind: 'harness-process', levelId: step.id, spawn: 1, reemit: false }),
			expect.objectContaining({ kind: 'level-end', id: step.id }),
			expect.objectContaining({ kind: 'level-end', id: plan.id }),
		]);
	});

	test('two recorders on one directory and label write under one id', async () => {
		const { open, path } = setupRecorder({ label: 'lo-150' });

		const first = open();
		const second = open();
		await first.settled();
		await second.settled();

		const marks = readMarks({ path });

		// Two plan subcommands run one after the other, neither reading the file:
		// their start marks still have to fold into one node rather than two.
		expect(marks).toEqual([
			expect.objectContaining({ kind: 'level-start', id: first.id, label: 'lo-150' }),
			expect.objectContaining({ kind: 'level-start', id: first.id, label: 'lo-150' }),
		]);
	});

	test('closing a level twice writes one end mark', async () => {
		const { open, path } = setupRecorder();

		const plan = open();
		plan.close({ outcome: RunStatus.Passed });
		plan.close({ outcome: RunStatus.Failed });
		await plan.settled();

		const marks = readMarks({ path });

		// A caller whose `finally` also closes must not put a second end time on
		// the level — the first close is the one that happened.
		expect(marks).toEqual([
			expect.objectContaining({ kind: 'level-start', id: plan.id }),
			expect.objectContaining({ kind: 'level-end', id: plan.id, outcome: 'passed' }),
		]);
	});

	test('an append that cannot be written never rejects the caller', async () => {
		const { open } = setupRecorder({ blocked: true });

		const plan = open();
		const step = plan.open({ level: ActivityLevelKind.Step, label: 'draft' });
		step.recordProcess({
			harness: 'claude-code',
			spawn: 1,
			reemit: false,
			startedAt: '2026-09-17T10:00:00.000Z',
			endedAt: '2026-09-17T10:01:00.000Z',
			endReason: ProcessEndReason.Failed,
		});
		step.close({ outcome: RunStatus.Failed });
		plan.close({ outcome: RunStatus.Failed });

		// Evidence must never fail the work it describes: every call returns a
		// usable handle and the tail settles, however broken the record is.
		expect(step.id).toEqual(expect.any(String));
		await expect(plan.settled()).resolves.toBeUndefined();
	});
});
