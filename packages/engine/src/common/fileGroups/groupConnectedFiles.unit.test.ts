import { expect, test } from '@jest/globals';
import { groupConnectedFiles } from '#src/common/fileGroups/groupConnectedFiles.ts';

test('groupConnectedFiles: chains merge, isolates stand alone, output is deterministic', () => {
	const files = ['c.ts', 'a.ts', 'b.ts', 'lonely.ts'];
	const edges = [
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'c.ts', to: 'b.ts' },
		{ from: 'a.ts', to: 'not-in-set.ts' },
	];

	expect(groupConnectedFiles({ files, edges })).toStrictEqual([['a.ts', 'b.ts', 'c.ts'], ['lonely.ts']]);
});

test('groupConnectedFiles: component membership and ordering are independent of edge order', () => {
	const files = ['z.ts', 'a.ts', 'm.ts', 'b.ts'];
	const edges = [
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'm.ts', to: 'z.ts' },
	];

	const forward = groupConnectedFiles({ files, edges });
	const reversed = groupConnectedFiles({ files, edges: [...edges].reverse() });

	expect(forward).toStrictEqual([
		['a.ts', 'b.ts'],
		['m.ts', 'z.ts'],
	]);
	// same components in the same order whichever way the edges arrive
	expect(reversed).toStrictEqual(forward);
});

test('groupConnectedFiles: a repeated edge and a self-edge merge nothing new', () => {
	const files = ['b.ts', 'a.ts'];
	const edges = [
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'a.ts', to: 'a.ts' },
	];

	expect(groupConnectedFiles({ files, edges })).toStrictEqual([['a.ts', 'b.ts']]);
});

test('groupConnectedFiles: no files yields no components, even with edges', () => {
	expect(groupConnectedFiles({ files: [], edges: [{ from: 'a.ts', to: 'b.ts' }] })).toStrictEqual([]);
});
