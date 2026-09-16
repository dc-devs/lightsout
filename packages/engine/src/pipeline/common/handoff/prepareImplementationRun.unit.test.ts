import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { prepareImplementationRun } from '#src/pipeline/common/handoff/prepareImplementationRun.ts';
import { createRun, readRunManifest, writeRunManifest } from '#src/runState/index.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';

const setup = async () => {
	const fixture = await planningHandoffFixture();
	const manifest = await createRun({ ...fixture, driver: 'stub', planningHandoff: fixture.handoff });
	const existing = await writeRunManifest({
		cwd: fixture.cwd,
		manifest: {
			...manifest,
			acceptanceTests: [{ criterion: 'Retain completion', testFile: 'src/renamed.unit.test.ts', testName: 'approved replacement', gate: 'test' }],
			steps: [
				{ id: 'implement', status: RunStatus.Passed, attempts: 1 },
				{ id: 'verify-implement', status: RunStatus.Passed, attempts: 1 },
				{ id: 'write-tests', status: RunStatus.Failed, attempts: 1 },
			],
		},
	});
	await writeFile(join(fixture.cwd, 'src/partial.ts'), 'export const retained = true;');
	return {
		...fixture,
		runId: existing.runId,
		existing,
		driver: {
			name: 'stub',
			invoke: async () => {
				throw new Error('Preparation must not dispatch a model');
			},
		},
	};
};

describe('prepareImplementationRun', () => {
	test('preserves completed writing and partial files while reopening verification on resume', async () => {
		const fixture = await setup();

		const run = await prepareImplementationRun(fixture);

		expect(run.current().steps.map((step) => ({ id: step.id, status: step.status }))).toStrictEqual([
			{ id: 'implement', status: 'passed' },
			{ id: 'verify-implement', status: 'pending' },
			{ id: 'write-tests', status: 'failed' },
		]);
		expect(await readFile(join(fixture.cwd, 'src/partial.ts'), 'utf8')).toBe('export const retained = true;');
		expect(run.current().acceptanceTests).toStrictEqual(fixture.existing.acceptanceTests);
		expect((await readRunManifest(fixture)).planningHandoff).toStrictEqual(fixture.handoff);
	});
});

test('refuses a new inherited child handoff without its owning coordinator', async () => {
	const fixture = await setup();
	await expect(prepareImplementationRun({ ...fixture, existing: undefined, planningHandoff: fixture.handoff })).rejects.toThrow('owning coordinator');
});
