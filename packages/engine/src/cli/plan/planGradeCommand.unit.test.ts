// Dependencies
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { planGradeCommand } from '#src/cli/plan/index.ts';
import { planningCanonicalCommandFixture as setup } from '#tests/helpers/planningCanonicalCommandFixture.ts';

describe('planGradeCommand', () => {
	test('reports the canonical grade and current independent coverage without new model calls', async () => {
		const fixture = await setup();

		const run = planGradeCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([0]);
		const grade = JSON.parse(await readFile(join(fixture.root, 'grade.json'), 'utf8'));
		expect(grade).toEqual(
			expect.objectContaining({ passed: true, complete: true, lenses: [], weights: [], workflow: expect.objectContaining({ format: 'planning-grade-v1' }) }),
		);
		expect(fixture.calls).toHaveLength(fixture.callsBefore);
		expect(fixture.logged.some((line) => line.includes('grade.json'))).toBe(true);
	});

	test('keeps a reviewed proposal incomplete until explicit approval', async () => {
		const fixture = await setup({ proposal: true });

		const run = planGradeCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([1]);
		const grade = JSON.parse(await readFile(join(fixture.root, 'grade.json'), 'utf8'));
		expect(grade).toEqual(expect.objectContaining({ passed: false, complete: false, incompleteReason: expect.stringContaining('approval') }));
	});

	test('refuses an unknown requested phase instead of grading less than requested', async () => {
		const fixture = await setup();

		const run = planGradeCommand({ ...fixture.params, phases: ['99'] });

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([1]);
		expect(fixture.errors.some((line) => line.includes('--phase 99 matches 0'))).toBe(true);
		expect(fixture.calls).toHaveLength(fixture.callsBefore);
	});

	test('marks an explicitly narrowed report incomplete even if full canonical readiness exists', async () => {
		const fixture = await setup();

		const run = planGradeCommand({ ...fixture.params, phases: ['plan.md'] });

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([1]);
		const grade = JSON.parse(await readFile(join(fixture.root, 'grade.json'), 'utf8'));
		expect(grade).toEqual(expect.objectContaining({ passed: false, complete: false, focusedOn: ['plan.md'], scope: 'focused' }));
	});
	test('shows unresolved canonical findings with their consequences and required remedy', async () => {
		const fixture = await setup({ finding: true });

		const run = planGradeCommand(fixture.params);

		await expect(run).rejects.toThrow('process.exit');
		expect(fixture.exitCodes).toEqual([1]);
		expect(fixture.logged.some((line) => line.includes('existing-retry-helper'))).toBe(true);
		expect(fixture.logged.some((line) => line.includes('user must upload completed content again'))).toBe(true);
		expect(fixture.logged.some((line) => line.includes('Preserve retry identity'))).toBe(true);
		expect(fixture.logged.some((line) => line.includes('no duplication found'))).toBe(false);
	});
});
