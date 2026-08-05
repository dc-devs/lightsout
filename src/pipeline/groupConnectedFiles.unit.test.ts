import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupConnectedFiles } from '@/pipeline';

test('groupConnectedFiles: chains merge, isolates stand alone, output is deterministic', () => {
	const files = ['c.ts', 'a.ts', 'b.ts', 'lonely.ts'];
	const edges = [
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'c.ts', to: 'b.ts' },
		{ from: 'a.ts', to: 'not-in-set.ts' },
	];

	assert.deepEqual(groupConnectedFiles({ files, edges }), [['a.ts', 'b.ts', 'c.ts'], ['lonely.ts']]);
});

test('groupConnectedFiles: component membership and ordering are independent of edge order', () => {
	const files = ['z.ts', 'a.ts', 'm.ts', 'b.ts'];
	const edges = [
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'm.ts', to: 'z.ts' },
	];

	const forward = groupConnectedFiles({ files, edges });
	const reversed = groupConnectedFiles({ files, edges: [...edges].reverse() });

	assert.deepEqual(forward, [
		['a.ts', 'b.ts'],
		['m.ts', 'z.ts'],
	]);
	assert.deepEqual(reversed, forward, 'same components in the same order whichever way the edges arrive');
});

test('groupConnectedFiles: a repeated edge and a self-edge merge nothing new', () => {
	const files = ['b.ts', 'a.ts'];
	const edges = [
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'a.ts', to: 'a.ts' },
	];

	assert.deepEqual(groupConnectedFiles({ files, edges }), [['a.ts', 'b.ts']]);
});

test('groupConnectedFiles: no files yields no components, even with edges', () => {
	assert.deepEqual(groupConnectedFiles({ files: [], edges: [{ from: 'a.ts', to: 'b.ts' }] }), []);
});
