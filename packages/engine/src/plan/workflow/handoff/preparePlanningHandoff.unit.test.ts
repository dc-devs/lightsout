import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { preparePlanningHandoff } from '#src/plan/workflow/handoff/index.ts';
import { createRun } from '#src/runState/index.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setupResume = async () => {
	const fixture = await planningHandoffFixture();
	const existing = await createRun({ ...fixture, driver: 'test', planningHandoff: fixture.handoff });
	return { ...fixture, existing };
};

describe('preparePlanningHandoff', () => {
	test('resumes its original generation without a model call after source edits', async () => {
		const fixture = await setupResume();
		await writeFile(join(fixture.cwd, 'src/manual.ts'), 'export const preserved = true;');
		const calls = fixture.calls.length;

		const handoff = await preparePlanningHandoff(fixture);

		expect(handoff).toStrictEqual(fixture.handoff);
		expect(fixture.calls).toHaveLength(calls);
	});
	test('rejects replacement of a resumed handoff', async () => {
		const fixture = await setupResume();

		await expect(preparePlanningHandoff({ ...fixture, inherited: { ...fixture.handoff, generation: 'a'.repeat(64) } })).rejects.toThrow('cannot replace');
	});
	test('does not freeze unfinished planning', async () => {
		const fixture = await planningWorkflowFixture();
		await fixture.capture();

		await expect(
			preparePlanningHandoff({ ...fixture, config: fixture.runtime.config, plan: join('.lightsout/plans', fixture.name, 'plan.md') }),
		).rejects.toThrow();
	});
	test('does not downgrade a missing canonical record to legacy', async () => {
		const fixture = await planningWorkflowFixture();
		const name = 'missing-handoff';
		await mkdir(join(fixture.cwd, '.lightsout/plans', name), { recursive: true });
		await writeFile(join(fixture.cwd, '.lightsout/plans', name, 'planning-record.json'), '{}');

		await expect(preparePlanningHandoff({ ...fixture, config: fixture.runtime.config, plan: join('.lightsout/plans', name, 'plan.md') })).rejects.toThrow();
	});
});

test('leaves legacy resumes legacy and refuses adopting later canonical authority', async () => {
	const fixture = await planningHandoffFixture();
	const existing = await createRun({ ...fixture, driver: 'stub' });
	expect(await preparePlanningHandoff({ ...fixture, existing })).toBeUndefined();
	await expect(preparePlanningHandoff({ ...fixture, existing, inherited: fixture.handoff })).rejects.toThrow('legacy run cannot adopt');
});

test('refuses a different plan address under a valid inherited handoff', async () => {
	const fixture = await planningHandoffFixture();
	await expect(preparePlanningHandoff({ ...fixture, plan: '.lightsout/plans/other/plan.md', inherited: fixture.handoff })).rejects.toThrow('Run path differs');
});

test('refuses a non-deliverable file under the correct inherited handoff', async () => {
	const fixture = await planningHandoffFixture();
	await expect(preparePlanningHandoff({ ...fixture, plan: join('.lightsout/plans', fixture.name, 'unknown.md'), inherited: fixture.handoff })).rejects.toThrow(
		'not a frozen deliverable',
	);
});

test('permits a managed legacy plan with no canonical authority markers', async () => {
	const fixture = await planningWorkflowFixture();
	await mkdir(fixture.root, { recursive: true });
	await writeFile(join(fixture.root, 'plan.md'), '# Existing legacy plan');
	expect(await preparePlanningHandoff({ ...fixture, config: fixture.runtime.config, plan: join(fixture.root, 'plan.md') })).toBeUndefined();
});
