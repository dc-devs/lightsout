import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const setup = async () => {
	const fixture = await planningStoreFixture();
	const result = await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });
	if (!result.committed) throw new Error('Expected initial committed snapshot');
	return { ...fixture, snapshot: result.snapshot };
};

test('returns independent records when reusing validation of unchanged committed bytes', async () => {
	const fixture = await setup();
	fixture.snapshot.record.claims[0].text = 'A caller changed its private result';
	fixture.snapshot.record.confirmations[0].delegation.packageRoots.push('unapproved');

	const result = await readPlanningSnapshot(fixture);

	expect(result?.record.claims).toEqual(fixture.record.claims);
	expect(result?.record.confirmations).toEqual(fixture.record.confirmations);
	expect(result?.artifacts.get('plan.md')).toBe('Preserve completed uploads');
});

test('rechecks blobs after a successful read and never promotes repeated corruption to valid history', async () => {
	const fixture = await setup();
	const path = join(fixture.root, '.planning', 'blobs', fixture.descriptor.sha256);
	await writeFile(path, 'Corrupted after a successful validation');

	await expect(readPlanningSnapshot(fixture)).rejects.toThrow('Corrupt committed planning artifact');
	await expect(readPlanningSnapshot(fixture)).rejects.toThrow('Corrupt committed planning artifact');

	expect(await readFile(path, 'utf8')).toBe('Corrupted after a successful validation');
});

test('verifies a long history and its original pin after validation proof eviction', async () => {
	const fixture = await setup();
	let parentDigest = fixture.snapshot.digest;
	for (let revision = 1; revision <= 1_030; revision++) {
		const record = { ...fixture.record, revision, parentDigest };
		const digest = sha256({ content: canonicalJson({ value: record }) });
		await writeFile(join(fixture.root, '.planning', 'commits', `${String(revision).padStart(10, '0')}.json`), canonicalJson({ value: { record, digest } }));
		parentDigest = digest;
	}
	const current = await readPlanningSnapshot(fixture);
	const original = await readPlanningSnapshot({ ...fixture, generation: fixture.snapshot.digest });
	const path = join(fixture.root, '.planning', 'commits', '0000000000.json');
	const bytes = await readFile(path, 'utf8');
	await writeFile(path, `${bytes}\n`);

	await expect(readPlanningSnapshot(fixture)).rejects.toThrow('Noncanonical or corrupt planning commit bytes');

	expect(current?.digest).toBe(parentDigest);
	expect(current?.record.revision).toBe(1_030);
	expect(original).toEqual(fixture.snapshot);
	expect(await readFile(path, 'utf8')).toBe(`${bytes}\n`);
}, 60_000);
