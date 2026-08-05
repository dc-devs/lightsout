import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkFileGroup } from '@/pipeline';

test('chunkFileGroup: splits above max into sorted slices', () => {
	const files = Array.from({ length: 13 }, (_, index) => `src/${String(index).padStart(2, '0')}.ts`);

	const chunks = chunkFileGroup({ files: [...files].reverse(), max: 12 });

	assert.equal(chunks.length, 2);
	assert.deepEqual(chunks[0], files.slice(0, 12));
	assert.deepEqual(chunks[1], files.slice(12));
	assert.deepEqual(chunkFileGroup({ files, max: 12 })[0]?.length, 12);
});

test('chunkFileGroup: a group that fits in max stays one sorted chunk, and the caller’s array is untouched', () => {
	const files = ['src/b.ts', 'src/a.ts', 'src/c.ts'];

	const chunks = chunkFileGroup({ files, max: 12 });

	assert.deepEqual(chunks, [['src/a.ts', 'src/b.ts', 'src/c.ts']]);
	assert.deepEqual(files, ['src/b.ts', 'src/a.ts', 'src/c.ts'], 'sorting a group never reorders the caller’s list');
});

test('chunkFileGroup: an exact multiple of max splits evenly, with no trailing empty chunk', () => {
	const files = Array.from({ length: 4 }, (_, index) => `src/${index}.ts`);

	const chunks = chunkFileGroup({ files, max: 2 });

	assert.deepEqual(chunks, [
		['src/0.ts', 'src/1.ts'],
		['src/2.ts', 'src/3.ts'],
	]);
});

test('chunkFileGroup: an empty group yields no chunks — nothing to spawn a writer for', () => {
	const chunks = chunkFileGroup({ files: [], max: 12 });

	assert.deepEqual(chunks, []);
});
