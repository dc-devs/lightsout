import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { approvedTestPath } from '#src/pipeline/approvedTests/approvedTestPath.ts';

test('approvedTestPath: the copy lives under the run folder, mirroring the repo-relative path', () => {
	const path = approvedTestPath({ cwd: '/repo', runId: 'run-7', path: 'packages/api/src/widget.unit.test.ts' });

	// the run owns its copies, so a second run never overwrites the first's baseline
	expect(path).toBe(join('/repo', '.lightsout', 'runs', 'run-7', 'approved', 'packages/api/src/widget.unit.test.ts'));
});

test('approvedTestPath: two files with the same basename keep separate copies', () => {
	const first = approvedTestPath({ cwd: '/repo', runId: 'run-7', path: 'packages/api/src/widget.unit.test.ts' });
	const second = approvedTestPath({ cwd: '/repo', runId: 'run-7', path: 'packages/web/src/widget.unit.test.ts' });

	// the repo-relative path is mirrored whole, so the copies cannot collide
	expect(first).not.toBe(second);
});

test('approvedTestPath: the same inputs always resolve to the same path', () => {
	const params = { cwd: '/repo', runId: 'run-7', path: 'src/a.test.ts' };

	// the approval that takes the copy and the collection that diffs against it
	// call this and nothing else — a second spelling is a baseline nothing reads
	expect(approvedTestPath(params)).toBe(approvedTestPath(params));
});
