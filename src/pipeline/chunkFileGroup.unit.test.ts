import { expect, test } from '@jest/globals';
import { chunkFileGroup } from '@/pipeline';

test('chunkFileGroup: splits above max into sorted slices', () => {
	const files = Array.from({ length: 13 }, (_, index) => `src/${String(index).padStart(2, '0')}.ts`);

	const chunks = chunkFileGroup({ files: [...files].reverse(), max: 12 });

	expect(chunks.length).toBe(2);
	expect(chunks[0]).toStrictEqual(files.slice(0, 12));
	expect(chunks[1]).toStrictEqual(files.slice(12));
	expect(chunkFileGroup({ files, max: 12 })[0]?.length).toStrictEqual(12);
});

test('chunkFileGroup: a group that fits in max stays one sorted chunk, and the caller’s array is untouched', () => {
	const files = ['src/b.ts', 'src/a.ts', 'src/c.ts'];

	const chunks = chunkFileGroup({ files, max: 12 });

	expect(chunks).toStrictEqual([['src/a.ts', 'src/b.ts', 'src/c.ts']]);
	// sorting a group never reorders the caller’s list
	expect(files).toStrictEqual(['src/b.ts', 'src/a.ts', 'src/c.ts']);
});

test('chunkFileGroup: an exact multiple of max splits evenly, with no trailing empty chunk', () => {
	const files = Array.from({ length: 4 }, (_, index) => `src/${index}.ts`);

	const chunks = chunkFileGroup({ files, max: 2 });

	expect(chunks).toStrictEqual([
		['src/0.ts', 'src/1.ts'],
		['src/2.ts', 'src/3.ts'],
	]);
});

test('chunkFileGroup: an empty group yields no chunks — nothing to spawn a writer for', () => {
	const chunks = chunkFileGroup({ files: [], max: 12 });

	expect(chunks).toStrictEqual([]);
});
