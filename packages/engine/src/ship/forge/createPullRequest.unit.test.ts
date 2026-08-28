import { describe, expect, test } from '@jest/globals';
import { createPullRequest } from '#src/ship/forge/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';

/** What one of the three stubbed `gh` calls answers with, in the shape the forge stub takes. */
interface ForgeCall {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

/** A forge that answers the three calls opening a pull request takes, each of which a test may fail on its own. */
const setupCreate = async ({ create = {}, edit = {}, view = {} }: { create?: ForgeCall; edit?: ForgeCall; view?: ForgeCall } = {}) => {
	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'pr create': { stdout: 'https://forge.example/acme/repo/pull/41', ...create },
			'pr edit': edit,
			'pr view': { stdout: viewed, ...view },
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

	test('a forge that refuses to open one answers with what it said, and never tries to edit a pull request that does not exist', async () => {
		const { cwd, readForgeLog } = await setupCreate({ create: { exitCode: 1, stdout: '', stderr: 'pull request create failed: no write access' } });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toStrictEqual({ stderr: 'pull request create failed: no write access' });
		expect(readForgeLog()).toStrictEqual(['pr create --fill-first --head lo-60-ship']);
	});

	test('a create whose output is not a pull request URL answers a failure saying nothing rather than editing some other number', async () => {
		const { cwd } = await setupCreate({ create: { stdout: 'Warning: you are on a fork' } });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toStrictEqual({ stderr: '' });
	});

	test('a body the forge would not write answers the edit’s own words, so ship never merges a pull request saying the wrong thing', async () => {
		const { cwd } = await setupCreate({ edit: { exitCode: 1, stderr: 'could not update body' } });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toStrictEqual({ stderr: 'could not update body' });
	});

	test('a read-back the forge refuses answers its words rather than a summary assembled from the request', async () => {
		const { cwd } = await setupCreate({ view: { exitCode: 1, stderr: 'no pull request found' } });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toStrictEqual({ stderr: 'no pull request found' });
	});

	test('a read-back missing the fields a summary needs answers a failure rather than a pull request with an undefined number', async () => {
		const { cwd } = await setupCreate({ view: { stdout: '{"number":41,"url":"https://forge.example/acme/repo/pull/41"}' } });

		const created = await createPullRequest({ branch: 'lo-60-ship', body: 'Closes LO-60', cwd });

		expect(created).toStrictEqual({ stderr: '' });
	});
});
