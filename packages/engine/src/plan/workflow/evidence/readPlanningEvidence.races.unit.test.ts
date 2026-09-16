import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, jest, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { readPlanningEvidence } from '#src/plan/workflow/evidence/index.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ replacement }: { replacement: 'directory' | 'file' | 'membership' }) => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	const root = await realpath(context.cwd);
	const path = join(root, 'source.ts');
	await context.write('source.ts', 'original source');
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const open = actual.open;
	let changed = false;
	jest.spyOn(actual, 'open').mockImplementation(async (...args) => {
		if (String(args[0]) !== path || changed) return open(...args);
		changed = true;
		if (replacement === 'directory') {
			await rename(path, `${path}.original`);
			await mkdir(path);
			return open(...args);
		}
		const handle = await open(...args);
		if (replacement === 'membership') {
			await writeFile(join(context.cwd, 'new.ts'), 'new caller');
			return handle;
		}
		await rename(path, `${path}.original`);
		await writeFile(path, 'replacement source');
		return handle;
	});
	return context;
};
test('refuses a directory substituted between path validation and opening', async () => {
	const { runtime } = await setup({ replacement: 'directory' });

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'race', operation: PlanningVocabulary.Operation.ReadFile, path: 'source.ts', reason: 'Read original source' },
		}),
	).rejects.toThrow(/not a regular file/);
});
test('rejects a replaced path even when the old open handle remains readable', async () => {
	const { runtime } = await setup({ replacement: 'file' });

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: { requestId: 'race', operation: PlanningVocabulary.Operation.ReadFile, path: 'source.ts', reason: 'Read original source' },
		}),
	).rejects.toThrow(/changed during acquisition/);
});

test('rejects a search whose directory membership changes during acquisition', async () => {
	const { runtime } = await setup({ replacement: 'membership' });

	await expect(
		readPlanningEvidence({
			runtime,
			assignmentId: 'investigator',
			request: {
				requestId: 'race',
				operation: PlanningVocabulary.Operation.Search,
				roots: ['.'],
				query: 'source',
				options: { regex: false, caseSensitive: true, glob: '**/*.ts', exclude: [] },
				reason: 'Find every caller',
			},
		}),
	).rejects.toThrow(/search directory changed/);
});
