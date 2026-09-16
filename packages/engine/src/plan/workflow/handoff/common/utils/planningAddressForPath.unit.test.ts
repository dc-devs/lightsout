import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { planningAddressForPath } from '#src/plan/workflow/handoff/common/utils/planningAddressForPath.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

test.each(['.planning', 'planning-record.json', 'planning-views.json', 'planning-standards.json'])(
	'refuses external canonical files recognized by %s',
	async (marker) => {
		const cwd = await freshCwd();
		const directory = join(cwd, 'external');
		await mkdir(directory);
		await writeFile(join(directory, marker), '{}');
		await expect(planningAddressForPath({ cwd, planPath: 'external/plan.md' })).rejects.toThrow('managed .lightsout/plans');
	},
);

test('allows a legacy file directly under the plans root', async () => {
	const cwd = await freshCwd();
	expect(await planningAddressForPath({ cwd, planPath: '.lightsout/plans/plan.md' })).toBeUndefined();
});
