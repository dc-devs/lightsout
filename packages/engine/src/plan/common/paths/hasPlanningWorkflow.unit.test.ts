import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { hasPlanningWorkflow } from '#src/plan/common/paths/hasPlanningWorkflow.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const setup = async () => {
	const cwd = await freshCwd();
	const name = 'retry';
	const directory = join(cwd, '.lightsout/plans', name);
	await mkdir(directory, { recursive: true });
	return { cwd, name, directory };
};

test.each(['plan', 'brainstorm'])('recognizes a %s generation marker even when its core is missing', async (kind) => {
	const fixture = await setup();
	await writeFile(
		join(fixture.directory, `${kind}-attachments.json`),
		JSON.stringify({ [`${kind === 'plan' ? 'planning' : 'brainstorm'}Generation`]: 'a'.repeat(64) }),
	);
	expect(await hasPlanningWorkflow(fixture)).toBe(true);
});

test.each(['lookup', 'marker'])('surfaces filesystem failure at canonical %s rather than falling back to legacy', async (kind) => {
	const fixture = await setup();
	if (kind === 'lookup') {
		await writeFile(join(fixture.directory, 'file'), 'not a directory');
		fixture.name += '/file/nested';
	} else await mkdir(join(fixture.directory, 'plan-attachments.json'));
	await expect(hasPlanningWorkflow(fixture)).rejects.toThrow(/ENOTDIR|EISDIR/);
});
