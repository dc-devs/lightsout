import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { PlanningProgress } from '#src/contracts/plan/progress/PlanningProgress.ts';
import { PlanningStep } from '#src/contracts/plan/progress/PlanningStep.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { getPlanningProgressPath } from '#src/plan/progress/getPlanningProgressPath.ts';
import { readPlanningProgress } from '#src/plan/progress/readPlanningProgress.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';

const validRecord: PlanningProgress = {
	name: 'valid',
	updatedAt: '2026-09-10T10:01:30.000Z',
	steps: [
		{
			step: PlanningStep.VerifyFacts,
			status: RunStatus.Passed,
			attempts: 2,
			pid: 4242,
			startedAt: '2026-09-10T10:00:00.000Z',
			finishedAt: '2026-09-10T10:00:30.000Z',
			durationMs: 30_000,
		},
		{
			step: PlanningStep.Draft,
			status: RunStatus.Running,
			attempts: 1,
			pid: 4242,
			startedAt: '2026-09-10T10:01:00.000Z',
		},
	],
};

/** A repo whose plan folders each hold one kind of planning record: valid, absent, not JSON, or off-contract. */
const setupPlanFolders = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-progress-'));
	const bodies: Record<string, string | undefined> = {
		valid: JSON.stringify(validRecord),
		absent: undefined,
		unparseable: 'not json at all',
		'zero-attempts': JSON.stringify({
			name: 'zero-attempts',
			updatedAt: '2026-09-10T10:00:00.000Z',
			steps: [{ step: PlanningStep.Draft, status: RunStatus.Running, attempts: 0, pid: 4242, startedAt: '2026-09-10T10:00:00.000Z' }],
		}),
	};

	for (const [name, body] of Object.entries(bodies)) {
		mkdirSync(planWorkspaceFolder({ cwd: cwd, name: name }), { recursive: true });

		if (body !== undefined) {
			writeFileSync(join(planWorkspaceFolder({ cwd: cwd, name: name }), 'planning-progress.json'), body, 'utf8');
		}
	}

	return { cwd, names: Object.keys(bodies) };
};

describe('readPlanningProgress', () => {
	test('answers undefined for an absent, unparseable or off-contract record, and the parsed record otherwise', async () => {
		const { cwd, names } = setupPlanFolders();

		const readings = await Promise.all(names.map((name) => readPlanningProgress({ cwd, name })));

		expect(readings).toStrictEqual([validRecord, undefined, undefined, undefined]);
	});

	test('getPlanningProgressPath names planning-progress.json inside the plan folder', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-progress-'));
		const planFolder = await planWorkspaceDir({ cwd, name: 'demo' });

		const path = await getPlanningProgressPath({ cwd, name: 'demo' });

		expect(path).toBe(join(planFolder, 'planning-progress.json'));
	});
});
