import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
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

		// the repo root has nothing to strip from git paths
		expect(prefix).toBe('');
	});

	test('a nested consumer reports its trailing-slash path inside the repo', async () => {
		const { cwd } = setupPrefixRepo({ nested: join('apps', 'api') });

		const prefix = await readGitPrefix({ cwd });

		expect(prefix).toBe('apps/api/');
	});

	test('a directory outside any worktree reports undefined', async () => {
		const { cwd } = setupPrefixRepo({ git: false });

		const prefix = await readGitPrefix({ cwd });

		// undefined is the signal to degrade to agent-reported files, never an empty
		// prefix
		expect(prefix).toBe(undefined);
	});

	test('a directory that does not exist reports no prefix rather than raising the spawn failure', async () => {
		// git cannot even be started here, which is not the caller's problem: the
		// prefix is an optional refinement, so an unanswerable question is undefined
		const prefix = await readGitPrefix({ cwd: '/lightsout/no/such/directory' });

		expect(prefix).toBe(undefined);
	});
});
