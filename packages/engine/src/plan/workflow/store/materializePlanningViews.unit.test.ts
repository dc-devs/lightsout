import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { commitPlanningSnapshot, materializePlanningViews, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ nested = false }: { nested?: boolean } = {}) => {
	const context = await planningStoreFixture();
	directories.push(context.cwd);
	if (nested) {
		context.record.artifacts[0].path = 'nested/plan.md';
		context.artifacts = new Map([['nested/plan.md', context.text]]);
	}
	const result = await commitPlanningSnapshot({ ...context, expectedRevision: -1, parentDigest: null });
	if (!result.committed) throw new Error('Fixture writer lost');
	return { ...context, snapshot: result.snapshot };
};
const setupConcurrent = async ({ kind }: { kind: string }) => {
	const context = await setup();
	const io = {
		checkpoint: async () => {
			if (kind === 'mixed') await writeFile(join(context.root, 'plan.md'), 'Uncommitted replacement');
			else {
				const snapshot = context.snapshot;
				await commitPlanningSnapshot({
					cwd: context.cwd,
					name: context.name,
					expectedRevision: 0,
					parentDigest: snapshot.digest,
					record: { ...snapshot.record, revision: 1, parentDigest: snapshot.digest },
					artifacts: snapshot.artifacts,
				});
			}
		},
	};
	return { ...context, io };
};

describe('materializePlanningViews', () => {
	test('writes nested projections with exact generation and content hashes', async () => {
		const { cwd, name, snapshot, root, text } = await setup({ nested: true });

		await materializePlanningViews({ cwd, name, snapshot });

		expect(await readFile(join(root, 'nested', 'plan.md'), 'utf8')).toBe(text);
		expect(JSON.parse(await readFile(join(root, 'planning-views.json'), 'utf8'))).toStrictEqual({
			format: 'planning-views-v1',
			generation: snapshot.digest,
			files: [{ path: 'nested/plan.md', sha256: sha256({ content: text }) }],
		});
	});
	test.each([
		['mixed', 'Mixed planning projections detected; retry materialization'],
		['new-generation', 'Planning projections changed during materialization; retry with the current generation'],
	])('reports concurrent changes without promoting projection bytes: %s', async (kind, message) => {
		const { cwd, name, snapshot, io, text } = await setupConcurrent({ kind });

		await expect(materializePlanningViews({ cwd, name, snapshot, io })).rejects.toThrow(message);

		expect((await readPlanningSnapshot({ cwd, name }))?.artifacts.get('plan.md')).toBe(text);
	});
	test('rejects a redirected projection parent without writing outside the plan', async () => {
		const { cwd, name, snapshot, root } = await setup({ nested: true });
		const outside = join(cwd, 'outside');
		await mkdir(outside);
		await writeFile(join(outside, 'plan.md'), 'Keep this file');
		await symlink(outside, join(root, 'nested'));

		await expect(materializePlanningViews({ cwd, name, snapshot })).rejects.toThrow('A planning view parent cannot be redirected');

		expect(await readFile(join(outside, 'plan.md'), 'utf8')).toBe('Keep this file');
	});
});
