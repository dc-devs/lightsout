import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { ledgerCopyPath } from '#src/pipeline/common/utils/ledgerCopyPath.ts';

test('ledgerCopyPath: the copy lives under the run folder, mirroring the repo-relative path', () => {
	const path = ledgerCopyPath({ cwd: '/repo', runId: 'run-7', path: 'packages/api/src/widget.unit.test.ts' });

	// the run owns its copies, so a second run never overwrites the first's lock
	expect(path).toBe(join('/repo', '.lightsout', 'runs', 'run-7', 'ledger', 'packages/api/src/widget.unit.test.ts'));
});

test('ledgerCopyPath: two files with the same basename keep separate copies', () => {
	const first = ledgerCopyPath({ cwd: '/repo', runId: 'run-7', path: 'packages/api/src/widget.unit.test.ts' });
	const second = ledgerCopyPath({ cwd: '/repo', runId: 'run-7', path: 'packages/web/src/widget.unit.test.ts' });

	// the repo-relative path is mirrored whole, so the copies cannot collide
	expect(first).not.toBe(second);
});

test('ledgerCopyPath: the same inputs always resolve to the same path', () => {
	const params = { cwd: '/repo', runId: 'run-7', path: 'src/a.test.ts' };

	// the step that takes the copy and the check that restores it call this and
	// nothing else — a second spelling of the path is a lock that never restores
	expect(ledgerCopyPath(params)).toBe(ledgerCopyPath(params));
});
