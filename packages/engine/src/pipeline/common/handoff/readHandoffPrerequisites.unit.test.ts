import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PipelineKind, PlanningHandoff, RunStatus } from '#src/contracts/index.ts';
import { readHandoffPrerequisites } from '#src/pipeline/common/handoff/readHandoffPrerequisites.ts';
import { createRun, writeRunManifest } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const setup = async () => {
	const cwd = setupConsumerRepo();
	const config = await readConfig({ cwd });
	const handoff = PlanningHandoff.parse({
		format: 'planning-handoff-v1',
		name: 'retry',
		generation: 'a'.repeat(64),
		phases: [1, 2, 3].map((id) => ({ id: `phase-${id}`, path: `phase${id}.md` })),
	});
	const root = '.lightsout/plans/retry';
	const parent = await createRun({ cwd, config, plan: join(root, 'overview.md'), pipeline: PipelineKind.Phases, driver: 'stub', planningHandoff: handoff });
	const oldRow = { criterion: 'Retain completion', testFile: 'src/old.unit.test.ts', testName: 'old name', gate: 'test' };
	const approvedRow = { ...oldRow, testFile: 'src/new.unit.test.ts', testName: 'approved new name' };
	const children = [];
	for (const [index, row] of [oldRow, approvedRow].entries()) {
		const child = await createRun({
			cwd,
			config,
			plan: join(root, `phase${index + 1}.md`),
			parentRunId: parent.runId,
			driver: 'stub',
			planningHandoff: handoff,
		});
		children.push(await writeRunManifest({ cwd, manifest: { ...child, status: RunStatus.Passed, acceptanceTests: [row] } }));
	}
	const manifest = await writeRunManifest({
		cwd,
		manifest: {
			...parent,
			steps: children.map((child, index) => ({ id: `phase${index + 1}.md`, status: RunStatus.Passed, attempts: 1, report: { runId: child.runId } })),
		},
	});
	return { cwd, handoff, parentRunId: parent.runId, plan: join(root, 'phase3.md'), approvedRow, manifest, children };
};

describe('readHandoffPrerequisites', () => {
	test('inherits the latest cumulative approved mapping without resurrecting renamed tests', async () => {
		const fixture = await setup();
		expect(await readHandoffPrerequisites(fixture)).toStrictEqual([fixture.approvedRow]);
	});
	test('still validates every earlier child before inheriting the latest mapping', async () => {
		const fixture = await setup();
		await writeRunManifest({ cwd: fixture.cwd, manifest: { ...fixture.children[0], status: RunStatus.Failed } });
		await expect(readHandoffPrerequisites(fixture)).rejects.toThrow('matching completed child');
	});
	test('refuses a later phase without its coordinator', async () => {
		const fixture = await setup();
		await expect(readHandoffPrerequisites({ ...fixture, parentRunId: undefined })).rejects.toThrow('completed prerequisites');
	});
});

test.each(['unknown-phase', 'different-coordinator', 'unfinished-step'])('refuses invalid continuation authority: %s', async (defect) => {
	const fixture = await setup();
	if (defect === 'unknown-phase') fixture.plan = '.lightsout/plans/retry/not-a-phase.md';
	if (defect === 'different-coordinator') fixture.handoff = { ...fixture.handoff, generation: 'b'.repeat(64) };
	if (defect === 'unfinished-step')
		await writeRunManifest({
			cwd: fixture.cwd,
			manifest: { ...fixture.manifest, steps: fixture.manifest.steps.map((step) => ({ ...step, status: RunStatus.Pending })) },
		});
	await expect(readHandoffPrerequisites(fixture)).rejects.toThrow(/frozen phase|differs from its coordinator|prerequisite is unfinished/);
});
