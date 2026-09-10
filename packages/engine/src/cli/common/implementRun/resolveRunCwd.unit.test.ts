import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveRunCwd } from '#src/cli/common/implementRun/resolveRunCwd.ts';
import { manifestOf } from '#tests/helpers/setupResume.ts';

/**
 * A launching checkout plus whatever the case wants standing at the recorded
 * workspace path: a directory, a file, or nothing at all.
 */
const setupRecordedWorkspace = ({ workspace }: { workspace?: 'directory' | 'file' | 'missing' } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-cwd-'));
	const workspacePath = join(cwd, 'worktrees', 'lo-1-demo');

	if (workspace === 'directory') {
		mkdirSync(workspacePath, { recursive: true });
	}

	if (workspace === 'file') {
		mkdirSync(join(cwd, 'worktrees'), { recursive: true });
		writeFileSync(workspacePath, 'not a checkout\n');
	}

	const manifest = manifestOf({ workspace: workspace === undefined ? undefined : workspacePath });

	return { cwd, manifest, workspacePath };
};

describe('resolveRunCwd', () => {
	test('a recorded workspace that is still on disk is where the work happens, never the checkout the manifest was read from', async () => {
		const { cwd, manifest, workspacePath } = setupRecordedWorkspace({ workspace: 'directory' });

		const resolved = await resolveRunCwd({ cwd, manifest });

		expect(resolved).toStrictEqual({ workspace: workspacePath });
	});

	test('a manifest that recorded no workspace resumes in the launching checkout', async () => {
		const { cwd, manifest } = setupRecordedWorkspace();

		const resolved = await resolveRunCwd({ cwd, manifest });

		expect(resolved).toStrictEqual({ workspace: cwd });
	});

	test('a recorded workspace that has gone is named in an error rather than silently swapped for the launching checkout', async () => {
		const { cwd, manifest, workspacePath } = setupRecordedWorkspace({ workspace: 'missing' });

		const resolved = await resolveRunCwd({ cwd, manifest });

		expect(resolved).toEqual({ error: expect.stringContaining(workspacePath) });
	});

	test('a recorded workspace that is a file is refused like a missing one', async () => {
		const { cwd, manifest, workspacePath } = setupRecordedWorkspace({ workspace: 'file' });

		const resolved = await resolveRunCwd({ cwd, manifest });

		expect(resolved).toEqual({ error: expect.stringContaining(workspacePath) });
	});
});
