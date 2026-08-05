import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { readGitPrefix } from '@/common/git/readGitPrefix';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/**
 * A consumer repo in a temp dir — committed by default, so `git rev-parse`
 * has a worktree to answer from. `nested` creates a subdirectory and anchors
 * the read there, the case where the consumer root is not the repo root.
 */
const setupPrefixRepo = ({ git = true, nested }: { git?: boolean; nested?: string } = {}) => {
	const root = setupConsumerRepo({ git });

	if (nested) {
		mkdirSync(join(root, nested), { recursive: true });
	}

	return { cwd: nested ? join(root, nested) : root };
};

describe('readGitPrefix', () => {
	test('a consumer that IS the repo root reports an empty prefix', async () => {
		const { cwd } = setupPrefixRepo();

		const prefix = await readGitPrefix({ cwd });

		assert.equal(prefix, '', 'the repo root has nothing to strip from git paths');
	});

	test('a nested consumer reports its trailing-slash path inside the repo', async () => {
		const { cwd } = setupPrefixRepo({ nested: join('apps', 'api') });

		const prefix = await readGitPrefix({ cwd });

		assert.equal(prefix, 'apps/api/');
	});

	test('a directory outside any worktree reports undefined', async () => {
		const { cwd } = setupPrefixRepo({ git: false });

		const prefix = await readGitPrefix({ cwd });

		assert.equal(prefix, undefined, 'undefined is the signal to degrade to agent-reported files, never an empty prefix');
	});
});
