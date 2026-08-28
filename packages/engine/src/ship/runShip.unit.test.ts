import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ShipMergeMethod } from '#src/contracts/index.ts';
import { runShip } from '#src/ship/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';
const greenChecks = '[{"name":"unit","bucket":"pass"}]';

/** The settings a resolved `ship` block hands the sequence — this repo's own, with its nested ticket groups. */
const settings = {
	ticketPattern: /^(?<ticket>lo-(?<number>\d+))/,
	pullRequestBody: 'Closes LO-{number} on {branch}',
	mergeMethod: ShipMergeMethod.Merge,
	afterImplement: false,
};

interface RepoParams {
	/** Files left uncommitted, which is what a blocked precondition looks like. */
	dirty?: Record<string, string>;
	/** Point origin at nothing, so the push is what fails. */
	brokenOrigin?: boolean;
	/** Run outside any worktree, which blocks before a branch name is known. */
	worktree?: boolean;
}

interface ForgeParams {
	list?: string;
	createExit?: number;
	checks?: string;
	mergeExit?: number;
}

/** A branch, a real origin, and a forge answering every call the sequence makes. */
const setupShip = async ({ repo = {}, forge = {} }: { repo?: RepoParams; forge?: ForgeParams } = {}) => {
	const progress: string[] = [];
	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'auth status': { exitCode: 0 },
			'pr list': { stdout: forge.list ?? '[]' },
			'pr create': { stdout: 'https://forge.example/acme/repo/pull/41', exitCode: forge.createExit ?? 0 },
			'pr edit': { exitCode: 0 },
			'pr view 41 --json number': { stdout: viewed },
			'pr view 41 --json mergeCommit': { stdout: '{"mergeCommit":{"oid":"0f1e2d3c"}}' },
			'pr checks': { stdout: forge.checks ?? greenChecks },
			'pr merge': { exitCode: forge.mergeExit ?? 0, stderr: forge.mergeExit === undefined ? '' : 'protected branch' },
		},
	});

	if (repo.worktree === false) {
		return { cwd: await freshCwd(), progress, readForgeLog, onProgress: (message: string) => progress.push(message) };
	}

	const { cwd } = setupBranchRepo({ branch: 'lo-60-ship', dirty: repo.dirty });

	if (repo.brokenOrigin === true) {
		execSync('git remote set-url origin /lightsout/no/such/origin', { cwd, stdio: 'ignore' });
	}

	return { cwd, progress, readForgeLog, onProgress: (message: string) => progress.push(message) };
};

/** The result file the run left on disk, which is the whole point of the command. */
const readShipResult = async ({ cwd, branch }: { cwd: string; branch: string }) =>
	JSON.parse(await readFile(join(cwd, '.lightsout', 'ship', `${branch}.json`), 'utf8'));

describe('runShip', () => {
	test('a clean branch on a green pull request ships, and the result carries what a tracker comment is built from', async () => {
		const { cwd, onProgress } = await setupShip();

		const result = await runShip({ cwd, settings, onProgress });

		expect(result).toEqual(
			expect.objectContaining({
				status: 'shipped',
				branch: 'lo-60-ship',
				ticketRef: 'lo-60',
				prNumber: 41,
				prUrl: 'https://forge.example/acme/repo/pull/41',
				prTitle: 'Add the ship command',
				mergeCommit: '0f1e2d3c',
			}),
		);
	});

	test('writes the shipped result to disk, because the file is what the next tool reads', async () => {
		const { cwd, progress, onProgress } = await setupShip();

		const result = await runShip({ cwd, settings, onProgress });

		expect(await readShipResult({ cwd, branch: 'lo-60-ship' })).toStrictEqual(result);
		expect(progress.some((line) => line.includes(join('.lightsout', 'ship', 'lo-60-ship.json')))).toBe(true);
	});

	test('renders the body from the branch’s own capture groups before opening the pull request', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip();

		await runShip({ cwd, settings, onProgress });

		expect(readForgeLog()).toContain('pr edit 41 --body Closes LO-60 on lo-60-ship');
	});

	test('adopts a pull request already open on the branch instead of opening a second one', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip({ forge: { list: `[${viewed}]` } });

		const result = await runShip({ cwd, settings, onProgress });

		expect(result.status).toBe('shipped');
		expect(readForgeLog().some((line) => line.startsWith('pr create'))).toBe(false);
	});

	test('a blocked precondition stops before the forge is touched, and still leaves a result on disk', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip({ repo: { dirty: { 'notes.md': 'half a thought\n' } } });

		const result = await runShip({ cwd, settings, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'dirty-tree', branch: 'lo-60-ship' }));
		expect(readForgeLog().some((line) => line.startsWith('pr '))).toBe(false);
	});

	test('a block before any branch name is known files its result under `unknown`', async () => {
		const { cwd, onProgress } = await setupShip({ repo: { worktree: false } });

		const result = await runShip({ cwd, settings, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'git-unreadable' }));
		expect(await readShipResult({ cwd, branch: 'unknown' })).toStrictEqual(result);
	});

	test('a push the remote will not take blocks before a pull request is opened', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip({ repo: { brokenOrigin: true } });

		const result = await runShip({ cwd, settings, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'push-failed', ticketRef: 'lo-60' }));
		expect(readForgeLog().some((line) => line.startsWith('pr '))).toBe(false);
	});

	test('a forge that will not open a pull request blocks with that reason', async () => {
		const { cwd, onProgress } = await setupShip({ forge: { createExit: 1 } });

		const result = await runShip({ cwd, settings, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'pull-request-unavailable' }));
	});

	test('a red check blocks and names what finished red, which is what the reader goes and fixes', async () => {
		const { cwd, onProgress } = await setupShip({ forge: { checks: '[{"name":"unit","bucket":"fail"}]' } });

		const result = await runShip({ cwd, settings, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'checks-failed', failingChecks: ['unit'] }));
	});

	test('a merge the forge refuses blocks rather than retrying, so re-running ship is the only resume path', async () => {
		const { cwd, onProgress } = await setupShip({ forge: { mergeExit: 1 } });

		const result = await runShip({ cwd, settings, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'merge-rejected', detail: expect.stringContaining('#41') }));
	});

	test('runs silently when no progress sink was handed in', async () => {
		const { cwd } = await setupShip();

		const result = await runShip({ cwd, settings });

		expect(result.status).toBe('shipped');
	});
});
