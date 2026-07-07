import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupConnectedFiles } from './index';

test('groupConnectedFiles: chains merge, isolates stand alone, output is deterministic', () => {
	const files = ['c.ts', 'a.ts', 'b.ts', 'lonely.ts'];
	const edges = [
		{ from: 'a.ts', to: 'b.ts' },
		{ from: 'c.ts', to: 'b.ts' },
		{ from: 'a.ts', to: 'not-in-set.ts' },
	];

	assert.deepEqual(groupConnectedFiles({ files, edges }), [['a.ts', 'b.ts', 'c.ts'], ['lonely.ts']]);
});
