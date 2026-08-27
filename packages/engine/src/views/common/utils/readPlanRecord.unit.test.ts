import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { z } from 'zod';
import type { PlanWorkspaceFile } from '#src/contracts/index.ts';
import { readPlanRecord } from '#src/views/common/utils/readPlanRecord.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const schema = z.object({ planName: z.string() });

/** A workspace file entry pointing at `decisions.json`, written with whatever text a case wants inside it. */
const seedRecord = async ({ raw }: { raw?: string }) => {
	const cwd = await freshCwd();
	const dir = join(cwd, '.lightsout', 'plans', 'add-search');
	const file: PlanWorkspaceFile = {
		name: 'decisions.json',
		path: '.lightsout/plans/add-search/decisions.json',
		bytes: 0,
		updatedAt: '2026-01-01T00:00:00.000Z',
	};

	await mkdir(dir, { recursive: true });

	if (raw !== undefined) {
		await writeFile(join(dir, 'decisions.json'), raw, 'utf8');
	}

	return { cwd, file };
};

test('a record that parses comes back as the value, with nothing to report', async () => {
	const { cwd, file } = await seedRecord({ raw: JSON.stringify({ planName: 'add-search' }) });

	expect(await readPlanRecord({ cwd, file, schema })).toStrictEqual({ value: { planName: 'add-search' } });
});

test('a workspace that does not have the record gets nothing back, and that is not a problem', async () => {
	const { cwd } = await seedRecord({});

	// no file passed is how a caller spells "this workspace has no decisions.json"
	expect(await readPlanRecord({ cwd, file: undefined, schema })).toStrictEqual({});
});

test('a record that is on the listing and not on disk says so rather than throwing', async () => {
	const { cwd, file } = await seedRecord({});

	expect(await readPlanRecord({ cwd, file, schema })).toStrictEqual({ problem: 'decisions.json could not be read' });
});

test('a record that is not JSON at all names the file rather than surfacing a parser error', async () => {
	const { cwd, file } = await seedRecord({ raw: '{ not json' });

	expect(await readPlanRecord({ cwd, file, schema })).toStrictEqual({ problem: 'decisions.json is not valid JSON' });
});

test('a record that parses and does not match its contract says which of the two went wrong', async () => {
	const { cwd, file } = await seedRecord({ raw: JSON.stringify({ planName: 42 }) });

	const { problem, value } = await readPlanRecord({ cwd, file, schema });

	// the viewer shows the broken file; it is the pipeline's readers that refuse to proceed
	expect({ starts: problem?.startsWith('decisions.json does not match its contract: '), value }).toStrictEqual({ starts: true, value: undefined });
});
