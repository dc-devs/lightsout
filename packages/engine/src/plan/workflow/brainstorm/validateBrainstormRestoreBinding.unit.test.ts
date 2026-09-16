import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { createPlanningRuntime, ensurePlanningInput, exportPlanningGeneration } from '#src/plan/index.ts';
import { validateBrainstormRestoreBinding } from '#src/plan/workflow/brainstorm/validateBrainstormRestoreBinding.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';

let fixture: Awaited<ReturnType<typeof planningAlignedFixture>>;
let planCore: string;
beforeAll(async () => {
	fixture = await planningAlignedFixture();
	const runtime = await createPlanningRuntime({
		...fixture,
		driver: fixture.runtime.driver,
		config: fixture.runtime.config,
		mode: fixture.runtime.mode,
		stage: PlanningVocabulary.Stage.Implementation,
	});
	await ensurePlanningInput({ runtime });
	const files = exportPlanningGeneration({ snapshot: await fixture.current() });
	planCore = files.get('planning-record.json') ?? '';
});
const setup = async () => {
	const cwd = await freshCwd();
	const directory = join(cwd, 'private');
	await mkdir(directory);
	await writeFile(join(directory, 'planning-record.json'), planCore);
	return { cwd, directory, name: fixture.name, core: fixture.files.get('brainstorm-record.json'), generation: fixture.snapshot.digest };
};

describe('validateBrainstormRestoreBinding', () => {
	test('accepts the exact archived design in a private restored plan', async () => {
		const params = await setup();
		expect((await validateBrainstormRestoreBinding(params))?.artifacts.get('planning-brainstorm-handoff.json')).toBe(params.core);
	});
	test.each([undefined, 'different design'])('refuses removal or substitution of the archived brainstorm: %s', async (core) => {
		const params = await setup();
		await expect(validateBrainstormRestoreBinding({ ...params, core })).rejects.toThrow('exact canonical brainstorm');
	});
	test('does not swallow corrupted private plan authority', async () => {
		const params = await setup();
		await writeFile(join(params.directory, 'planning-record.json'), 'corrupt');
		await expect(validateBrainstormRestoreBinding(params)).rejects.toThrow();
	});
	test('refuses unrelated existing canonical authority even without an archived handoff', async () => {
		await expect(validateBrainstormRestoreBinding({ cwd: fixture.cwd, name: fixture.name, core: 'other', generation: 'b'.repeat(64) })).rejects.toThrow(
			'exact canonical brainstorm',
		);
	});
});

test('refuses replacing a current brainstorm before any implementation handoff exists', async () => {
	const current = await planningAlignedFixture();
	await expect(validateBrainstormRestoreBinding({ cwd: current.cwd, name: current.name, core: 'different', generation: 'b'.repeat(64) })).rejects.toThrow(
		'does not bind this brainstorm generation',
	);
});
