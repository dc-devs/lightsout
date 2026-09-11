import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { PlanningProgress } from '#src/contracts/index.ts';
import { PlanningStep, RunStatus } from '#src/contracts/index.ts';
import { planWorkspaceDir } from '#src/plan/index.ts';
import { getPlanningProgressPath, readPlanningProgress } from '#src/plan/progress/index.ts';

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
		mkdirSync(join(cwd, '.lightsout', 'plans', name), { recursive: true });

		if (body !== undefined) {
			writeFileSync(join(cwd, '.lightsout', 'plans', name, 'planning-progress.json'), body, 'utf8');
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

	test('getPlanningProgressPath names planning-progress.json inside the plan folder', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-progress-'));
		const planFolder = planWorkspaceDir({ cwd, name: 'demo' });

		const path = getPlanningProgressPath({ cwd, name: 'demo' });

		expect(path).toBe(join(planFolder, 'planning-progress.json'));
	});
});
