import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

test.each(['source-bytes', 'source-reference', 'binary-artifact'])(
	'refuses a recomputed checksum that conceals invalid semantic or text content: %s',
	async (variant) => {
		const fixture = await planningStoreFixture();
		const committed = await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });
		if (!committed.committed) throw new Error('Expected initial commit');
		const record = structuredClone(committed.snapshot.record);
		if (variant === 'source-bytes') record.sources.push({ artifact: 'unbound.txt', locator: 'Original', text: 'Actual bytes', sha256: 'a'.repeat(64) });
		if (variant === 'source-reference') record.sources = [];
		if (variant === 'binary-artifact') {
			const binary = Buffer.from([0xc3, 0x28]);
			record.artifacts[0].sha256 = sha256({ content: binary });
			await writeFile(join(fixture.root, '.planning', 'blobs', record.artifacts[0].sha256), binary);
		}
		const path = join(fixture.root, '.planning', 'commits', '0000000000.json');
		const bytes = canonicalJson({ value: { record, digest: sha256({ content: canonicalJson({ value: record }) }) } });
		await writeFile(path, bytes);
		await expect(readPlanningSnapshot(fixture)).rejects.toThrow(
			variant === 'binary-artifact' ? 'Corrupt committed planning artifact' : 'Invalid planning record',
		);
		expect(await readFile(path, 'utf8')).toBe(bytes);
	},
);

test('reports an unreadable commit directory instead of pretending planning data is absent', async () => {
	const fixture = await planningStoreFixture();
	await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const readdir = actual.readdir;
	jest.spyOn(actual, 'readdir').mockImplementation((...args) => {
		if (String(args[0]).endsWith('/.planning/commits')) return Promise.reject(Object.assign(new Error('Commit directory inaccessible'), { code: 'EACCES' }));
		return readdir(...args);
	});
	await expect(readPlanningSnapshot(fixture)).rejects.toThrow('Commit directory inaccessible');
});
