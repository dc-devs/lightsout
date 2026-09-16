import { readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ committed = true, corruption }: { committed?: boolean; corruption?: string } = {}) => {
	const context = await planningStoreFixture();
	directories.push(context.cwd);
	const { cwd, name, record, artifacts, root } = context;
	const first = committed ? await commitPlanningSnapshot({ cwd, name, record, artifacts, expectedRevision: -1, parentDigest: null }) : undefined;
	if (first !== undefined && !first.committed) throw new Error('Unexpected fixture writer');
	const file = join(root, '.planning', 'commits', '0000000000.json');
	if (corruption === 'gap') await rename(file, join(root, '.planning', 'commits', '0000000001.json'));
	if (corruption === 'checksum') {
		const envelope = JSON.parse(await readFile(file, 'utf8'));
		envelope.digest = 'a'.repeat(64);
		await writeFile(file, canonicalJson({ value: envelope }));
	}
	if (corruption === 'noncanonical') await writeFile(file, `${await readFile(file, 'utf8')}\n`);
	if (corruption === 'chain') {
		const altered = { ...record, parentDigest: 'a'.repeat(64) };
		await writeFile(file, canonicalJson({ value: { record: altered, digest: sha256({ content: canonicalJson({ value: altered }) }) } }));
	}
	if (corruption === 'symlink') {
		await rename(file, join(root, 'redirect.json'));
		await symlink(join(root, 'redirect.json'), file);
	}
	return { ...context, snapshot: first?.snapshot };
};

describe('readPlanningSnapshot', () => {
	test('returns absence only for an untouched workspace', async () => {
		const { cwd, name } = await setup({ committed: false });

		const result = await readPlanningSnapshot({ cwd, name });

		expect(result).toBeUndefined();
	});
	test('refuses a missing requested generation instead of substituting latest', async () => {
		const { cwd, name } = await setup();

		await expect(readPlanningSnapshot({ cwd, name, generation: 'e'.repeat(64) })).rejects.toThrow('Missing pinned planning generation');
	});
	test.each(['gap', 'checksum', 'noncanonical', 'chain', 'symlink'])('refuses corrupt canonical storage: %s', async (corruption) => {
		const { cwd, name } = await setup({ corruption });

		await expect(readPlanningSnapshot({ cwd, name })).rejects.toThrow();
	});
	test('keeps pinned original content after a later valid generation', async () => {
		const { cwd, name, snapshot } = await setup();
		if (snapshot === undefined) throw new Error('Missing setup generation');
		const record = { ...snapshot.record, revision: 1, parentDigest: snapshot.digest };
		await commitPlanningSnapshot({ cwd, name, record, artifacts: snapshot.artifacts, expectedRevision: 0, parentDigest: snapshot.digest });

		const result = await readPlanningSnapshot({ cwd, name, generation: snapshot.digest });

		expect(result).toStrictEqual(snapshot);
	});
});
