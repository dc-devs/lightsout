import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

test('commits a successor without rewriting already verified immutable blobs', async () => {
	const fixture = await planningStoreFixture();
	const first = await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });
	if (!first.committed) throw new Error('Expected initial committed generation');
	const blob = join(fixture.root, '.planning', 'blobs', fixture.descriptor.sha256);
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const open = actual.open;
	let attemptedRewrite = false;
	jest.spyOn(actual, 'open').mockImplementation(async (...args) => {
		if (String(args[0]).startsWith(`${blob}.`) && args[1] === 'wx') {
			attemptedRewrite = true;
			throw new Error('Existing immutable content needs no writable temporary file');
		}
		return open(...args);
	});
	const checkpoints: string[] = [];
	const next = await commitPlanningSnapshot({
		...fixture,
		expectedRevision: 0,
		parentDigest: first.snapshot.digest,
		record: { ...first.snapshot.record, revision: 1, parentDigest: first.snapshot.digest },
		io: {
			checkpoint: async ({ operation }) => {
				checkpoints.push(operation);
			},
		},
	});
	expect(next.committed).toBe(true);
	expect(attemptedRewrite).toBe(false);
	expect(checkpoints).toStrictEqual(['blob', 'candidate', 'commit']);
	const restored = await readPlanningSnapshot(fixture);
	expect(restored?.record.revision).toBe(1);
	expect(restored?.record.parentDigest).toBe(first.snapshot.digest);
	expect(restored?.artifacts).toStrictEqual(fixture.artifacts);
});

test.each(['EINVAL', 'ENOTSUP', 'EIO'])('handles a directory fsync failure without weakening file writes: %s', async (code) => {
	const fixture = await planningStoreFixture();
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const open = actual.open;
	let opened = 0;
	let closed = 0;
	jest.spyOn(actual, 'open').mockImplementation(async (...args) => {
		const handle = await open(...args);
		if (String(args[0]).endsWith('/.planning/blobs') || String(args[0]).endsWith('/.planning/commits')) {
			opened++;
			const close = handle.close.bind(handle);
			jest.spyOn(handle, 'sync').mockRejectedValue(Object.assign(new Error('Directory sync failed'), { code }));
			jest.spyOn(handle, 'close').mockImplementation(async () => {
				closed++;
				await close();
			});
		}
		return handle;
	});
	const pending = commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });
	if (code === 'EIO') {
		await expect(pending).rejects.toThrow('Directory sync failed');
		expect(await readPlanningSnapshot(fixture)).toBeUndefined();
	} else {
		const committed = await pending;
		expect(committed.committed).toBe(true);
		expect((await readPlanningSnapshot(fixture))?.artifacts).toStrictEqual(fixture.artifacts);
	}
	expect(opened).toBeGreaterThan(0);
	expect(closed).toBe(opened);
});

test('refuses publication when the filesystem cannot provide its atomic commit primitive', async () => {
	const fixture = await planningStoreFixture();
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const link = actual.link;
	let refused = false;
	jest.spyOn(actual, 'link').mockImplementation(async (...args) => {
		if (String(args[1]).includes('/.planning/commits/')) {
			refused = true;
			throw Object.assign(new Error('Atomic link unavailable'), { code: 'EOPNOTSUPP' });
		}
		return link(...args);
	});
	await expect(commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null })).rejects.toThrow('Atomic link unavailable');
	expect(refused).toBe(true);
	expect(await readPlanningSnapshot(fixture)).toBeUndefined();
	expect(await readdir(`${fixture.root}/.planning/commits`)).toStrictEqual([]);
});
