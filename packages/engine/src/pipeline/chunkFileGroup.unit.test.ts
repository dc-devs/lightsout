import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkFileGroup } from './index';

test('chunkFileGroup: splits above max into sorted slices', () => {
	const files = Array.from({ length: 13 }, (_, index) => `src/${String(index).padStart(2, '0')}.ts`);

	const chunks = chunkFileGroup({ files: [...files].reverse(), max: 12 });

	assert.equal(chunks.length, 2);
	assert.deepEqual(chunks[0], files.slice(0, 12));
	assert.deepEqual(chunks[1], files.slice(12));
	assert.deepEqual(chunkFileGroup({ files, max: 12 })[0]?.length, 12);
});
