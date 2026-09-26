import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { approvedTestPath } from '#src/pipeline/approvedTests/internal/approvedTestPath.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

const runId = 'run-7';

/** A repo holding the run's folder, because the path helper looks the run up by id. */
const setup = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-approved-path-'));

	mkdirSync(runDirFor({ cwd, runId }), { recursive: true });

	return { cwd };
};

test('approvedTestPath: the copy lives under the run folder, mirroring the repo-relative path', async () => {
	const { cwd } = setup();
	const path = await approvedTestPath({ cwd, runId, path: 'packages/api/src/widget.unit.test.ts' });

	// the run owns its copies, so a second run never overwrites the first's baseline
	expect(path).toBe(join(runDirFor({ cwd, runId }), 'approved', 'packages/api/src/widget.unit.test.ts'));
});

test('approvedTestPath: two files with the same basename keep separate copies', async () => {
	const { cwd } = setup();
	const first = await approvedTestPath({ cwd, runId, path: 'packages/api/src/widget.unit.test.ts' });
	const second = await approvedTestPath({ cwd, runId, path: 'packages/web/src/widget.unit.test.ts' });

	// the repo-relative path is mirrored whole, so the copies cannot collide
	expect(first).not.toBe(second);
});

test('approvedTestPath: the same inputs always resolve to the same path', async () => {
	const { cwd } = setup();
	const params = { cwd, runId, path: 'src/a.test.ts' };

	// the approval that takes the copy and the collection that diffs against it
	// call this and nothing else — a second spelling is a baseline nothing reads
	expect(await approvedTestPath(params)).toBe(await approvedTestPath(params));
});
