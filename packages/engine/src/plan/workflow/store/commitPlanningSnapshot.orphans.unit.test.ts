import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

test('refuses a corrupt orphan at an immutable content address without publishing or overwriting it', async () => {
	const fixture = await planningStoreFixture();
	const blobs = join(fixture.root, '.planning', 'blobs');
	await mkdir(blobs, { recursive: true });
	const path = join(blobs, fixture.descriptor.sha256);
	await writeFile(path, 'Interrupted corrupt original bytes');
	await expect(commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null })).rejects.toThrow('Corrupt immutable planning blob');
	expect(await readFile(path, 'utf8')).toBe('Interrupted corrupt original bytes');
	expect(await readPlanningSnapshot(fixture)).toBeUndefined();
	expect(await readdir(join(fixture.root, '.planning', 'commits'))).toStrictEqual([]);
	expect((await readdir(blobs)).filter((path) => path.endsWith('.partial'))).toStrictEqual([]);
});

test.each(['symlink', 'directory'])('does not adopt a nonregular orphan as verified immutable content: %s', async (kind) => {
	const fixture = await planningStoreFixture();
	const blobs = join(fixture.root, '.planning', 'blobs');
	await mkdir(blobs, { recursive: true });
	const path = join(blobs, fixture.descriptor.sha256);
	const outside = join(fixture.cwd, 'original.txt');
	await writeFile(outside, fixture.text);
	if (kind === 'symlink') await symlink(outside, path);
	else await mkdir(path);
	await expect(commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null })).rejects.toThrow();
	expect(await readFile(outside, 'utf8')).toBe(fixture.text);
	expect(await readPlanningSnapshot(fixture)).toBeUndefined();
	expect(await readdir(join(fixture.root, '.planning', 'commits'))).toStrictEqual([]);
	expect((await readdir(blobs)).filter((entry) => entry.endsWith('.partial'))).toStrictEqual([]);
});
