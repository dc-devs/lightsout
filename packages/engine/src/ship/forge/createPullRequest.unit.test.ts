import { describe, expect, test } from '@jest/globals';
import { createPullRequest } from '#src/ship/forge/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';

/** A forge that answers the three calls opening a pull request takes, each of which a test may fail on its own. */
const setupCreate = async ({
	createExit = 0,
	createStdout = 'https://forge.example/acme/repo/pull/41',
	editExit = 0,
	viewExit = 0,
}: {
	createExit?: number;
	createStdout?: string;
	editExit?: number;
	viewExit?: number;
} = {}) => {
	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'pr create': { stdout: createStdout, exitCode: createExit },
			'pr edit': { exitCode: editExit },
			'pr view': { stdout: viewed, exitCode: viewExit },
		},
	});
	const cwd = await freshCwd();

	return { cwd, readForgeLog };
};

describe('createPullRequest', () => {
	test('opens the pull request and answers with what the forge recorded, not with what was asked for', async () => {
		const { cwd } = await setupCreate();

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toStrictEqual({
			number: 41,
			url: 'https://forge.example/acme/repo/pull/41',
			title: 'Add the ship command',
			branch: 'lo-60-ship',
		});
	});

	test('takes the title from the branch’s first commit, then writes the rendered body over the one that came with it', async () => {
		const { cwd, readForgeLog } = await setupCreate();

		await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(readForgeLog()).toStrictEqual([
			'pr create --fill-first --head lo-60-ship',
			'pr edit 41 --body Closes LO-60',
			'pr view 41 --json number,url,title,headRefName',
		]);
	});

	test('a forge that refuses to open one answers undefined, and never tries to edit a pull request that does not exist', async () => {
		const { cwd, readForgeLog } = await setupCreate({ createExit: 1, createStdout: '' });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toBe(undefined);
		expect(readForgeLog()).toStrictEqual(['pr create --fill-first --head lo-60-ship']);
	});

	test('a create whose output is not a pull request URL answers undefined rather than editing some other number', async () => {
		const { cwd } = await setupCreate({ createStdout: 'Warning: you are on a fork' });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toBe(undefined);
	});

	test('a body the forge would not write answers undefined, so ship never merges a pull request saying the wrong thing', async () => {
		const { cwd } = await setupCreate({ editExit: 1 });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toBe(undefined);
	});

	test('a read-back the forge refuses answers undefined rather than a summary assembled from the request', async () => {
		const { cwd } = await setupCreate({ viewExit: 1 });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toBe(undefined);
	});
});
