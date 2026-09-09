import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ShipMergeMethod } from '#src/contracts/index.ts';
import { runShip } from '#src/ship/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';
const greenChecks = '[{"name":"unit","bucket":"pass"}]';

/**
 * The pull request's head, answered from the checkout at call time.
 *
 * The candidate is whatever the sequence committed — a merge, a rebuilt
 * release, nothing at all — so the fixture cannot write it down in advance.
 */
const headView = '{"headRefOid":"__HEAD__"}';

/** The merge read-back: merged when the merge command worked, and open and clean when it refused, so a refusal is classified as final rather than recoverable. */
const stateView = ({ merged }: { merged: boolean }) =>
	merged
		? '{"state":"MERGED","mergeCommit":{"oid":"0f1e2d3c"},"headRefOid":"__HEAD__","mergeStateStatus":"CLEAN","reviewDecision":null}'
		: '{"state":"OPEN","mergeCommit":null,"headRefOid":"__HEAD__","mergeStateStatus":"CLEAN","reviewDecision":null}';

/** The config and harness the integration step recovers with — never spawned here, because nothing in this file arranges a conflict or a red gate. */
const integration = shipIntegrationFixture();

/** The settings a resolved `ship` block hands the sequence — this repo's own, with its nested ticket groups. */
const settings = {
	ticketPattern: /^(?<ticket>lo-(?<number>\d+))/,
	pullRequestBody: 'Closes LO-{number} on {branch}',
	mergeMethod: ShipMergeMethod.Merge,
	afterImplement: false,
	preShip: undefined,
	allowNoCi: false,
};

interface RepoParams {
	/** Files left uncommitted, which is what a blocked precondition looks like. */
	dirty?: Record<string, string>;
	/** Point origin's PUSH url at nothing, so the fetch still works and the push is what fails. */
	brokenOrigin?: boolean;
	/** Push the branch before ship runs, so the remote already holds the commit ship is about to offer. */
	prePushed?: boolean;
	/** Run outside any worktree, which blocks before a branch name is known. */
	worktree?: boolean;
}

interface ForgeParams {
	list?: string;
	createExit?: number;
	createStderr?: string;
	checks?: string;
	mergeExit?: number;
	mergeStderr?: string;
}

/** A branch, a real origin, and a forge answering every call the sequence makes. */
const setupShip = async ({ repo = {}, forge = {} }: { repo?: RepoParams; forge?: ForgeParams } = {}) => {
	const progress: string[] = [];
	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'auth status': { exitCode: 0 },
			'pr list': { stdout: forge.list ?? '[]' },
			'pr create': { stdout: 'https://forge.example/acme/repo/pull/41', stderr: forge.createStderr ?? '', exitCode: forge.createExit ?? 0 },
			'pr edit': { exitCode: 0 },
			'pr view 41 --json number': { stdout: viewed },
			'pr view 41 --json headRefOid,statusCheckRollup': { stdout: '', exitCode: 1 },
			'pr view 41 --json headRefOid': { stdout: headView },
			'pr view 41 --json state': { stdout: stateView({ merged: (forge.mergeExit ?? 0) === 0 }) },
			'pr checks': { stdout: forge.checks ?? greenChecks },
			'pr merge': { exitCode: forge.mergeExit ?? 0, stderr: forge.mergeStderr ?? (forge.mergeExit === undefined ? '' : 'protected branch') },
		},
	});

	if (repo.worktree === false) {
		return { cwd: await freshCwd(), progress, readForgeLog, onProgress: (message: string) => progress.push(message) };
	}

	const { cwd } = setupBranchRepo({ branch: 'lo-60-ship', dirty: repo.dirty });

	if (repo.prePushed === true) {
		execSync('git push -q --set-upstream origin lo-60-ship', { cwd, stdio: 'ignore' });
	}

	if (repo.brokenOrigin === true) {
		execSync('git remote set-url --push origin /lightsout/no/such/origin', { cwd, stdio: 'ignore' });
	}

	return { cwd, progress, readForgeLog, onProgress: (message: string) => progress.push(message) };
};

/** The result file the run left on disk, which is the whole point of the command. */
const readShipResult = async ({ cwd, branch }: { cwd: string; branch: string }) =>
	JSON.parse(await readFile(join(cwd, '.lightsout', 'ship', `${branch}.json`), 'utf8'));

describe('runShip', () => {
	test('a clean branch on a green pull request ships, and the result carries what a tracker comment is built from', async () => {
		const { cwd, onProgress } = await setupShip();

		const result = await runShip({ cwd, settings, integration, onProgress });

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

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(await readShipResult({ cwd, branch: 'lo-60-ship' })).toStrictEqual(result);
		expect(progress.some((line) => line.includes(join('.lightsout', 'ship', 'lo-60-ship.json')))).toBe(true);
	});

	test('renders the body from the branch’s own capture groups before opening the pull request', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip();

		await runShip({ cwd, settings, integration, onProgress });

		expect(readForgeLog()).toContain('pr edit 41 --body Closes LO-60 on lo-60-ship');
	});

	test('adopts a pull request already open on the branch instead of opening a second one', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip({ forge: { list: `[${viewed}]` } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result.status).toBe('shipped');
		expect(readForgeLog().some((line) => line.startsWith('pr create'))).toBe(false);
	});

	test('asks the forge only for the branch’s open pull request, so a merged one is never adopted as a resume', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip();

		await runShip({ cwd, settings, integration, onProgress });

		expect(readForgeLog()).toContain('pr list --head lo-60-ship --state open --json number,url,title,headRefName --limit 1');
	});

	test('a blocked precondition stops before the forge is touched, and still leaves a result on disk', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip({ repo: { dirty: { 'brainstorm-notes.md': 'half a thought\n' } } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'dirty-tree', branch: 'lo-60-ship' }));
		expect(readForgeLog().some((line) => line.startsWith('pr '))).toBe(false);
	});

	test('the pre-ship command prepares the tree, and only the verified result is committed and pushed', async () => {
		const { cwd, onProgress } = await setupShip();

		const result = await runShip({ cwd, settings: { ...settings, preShip: 'echo rebuilt > bundle.txt' }, integration, onProgress });

		expect(result.status).toBe('shipped');
		// the hook's output is on the remote, so it was committed — and it got
		// there through the gates rather than around them
		expect(execSync('git ls-tree -r --name-only origin/lo-60-ship', { cwd, encoding: 'utf8' })).toContain('bundle.txt');
	});

	test('a failing pre-ship command blocks the ship with the command’s own words, before a pull request is touched', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip();

		const result = await runShip({ cwd, settings: { ...settings, preShip: 'echo no bundler here && exit 1' }, integration, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'pre-ship-failed', detail: expect.stringContaining('no bundler here') }));
		expect(readForgeLog().some((line) => line.startsWith('pr '))).toBe(false);
	});

	test('a block before any branch name is known files its result under `unknown`', async () => {
		const { cwd, onProgress } = await setupShip({ repo: { worktree: false } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'git-unreadable' }));
		expect(await readShipResult({ cwd, branch: 'unknown' })).toStrictEqual(result);
	});

	test('a push the remote will not take blocks before a pull request is opened', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip({ repo: { brokenOrigin: true } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result).toEqual(
			expect.objectContaining({
				status: 'blocked',
				reason: 'push-failed',
				ticketRef: 'lo-60',
				detail: expect.stringContaining("git could not push 'lo-60-ship' to origin: "),
			}),
		);
		expect(readForgeLog().some((line) => line.startsWith('pr '))).toBe(false);
	});

	test('a push that failed with the candidate already on the remote ships, because the remote’s own ref is what answers', async () => {
		const { cwd, readForgeLog, onProgress } = await setupShip({ repo: { prePushed: true, brokenOrigin: true } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		const published = execSync('git ls-remote --heads origin lo-60-ship', { cwd, encoding: 'utf8' }).split('\t')[0] ?? '';

		// the push command failed, and the commit it would have published was
		// already there — so the merge was asked for that exact commit rather than
		// the sequence stopping on an outcome the remote had already settled
		expect(result.status).toBe('shipped');
		expect(readForgeLog()).toContain(`pr merge 41 --merge --delete-branch --match-head-commit ${published}`);
	});

	test('a forge that will not open a pull request blocks with that reason, and with what the forge said', async () => {
		const { cwd, onProgress } = await setupShip({ forge: { createExit: 1, createStderr: 'gh: no write access' } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result).toEqual(
			expect.objectContaining({
				status: 'blocked',
				reason: 'pull-request-unavailable',
				detail: "no pull request could be opened or read for 'lo-60-ship': gh: no write access",
			}),
		);
	});

	// The masking, trimming and capping the sentence gets are the extracted
	// `appendCommandOutput` helper's own subject now, and its tests beside it
	// pin them; what stays here is the sentence each step contributes.
	test('a command that failed without saying anything leaves the sentence alone', async () => {
		const { cwd, onProgress } = await setupShip({ forge: { createExit: 1, createStderr: '' } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result.detail).toBe("no pull request could be opened or read for 'lo-60-ship'");
	});

	test('a red check blocks and names what finished red, which is what the reader goes and fixes', async () => {
		const { cwd, onProgress } = await setupShip({ forge: { checks: '[{"name":"unit","bucket":"fail"}]' } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'checks-failed', failingChecks: ['unit'] }));
	});

	test('a merge the forge refuses blocks rather than retrying, so re-running ship is the only resume path', async () => {
		const { cwd, onProgress } = await setupShip({ forge: { mergeExit: 1 } });

		const result = await runShip({ cwd, settings, integration, onProgress });

		expect(result).toEqual(
			expect.objectContaining({ status: 'blocked', reason: 'merge-rejected', detail: 'the forge refused to merge #41: protected branch' }),
		);
	});

	test('runs silently when no progress sink was handed in', async () => {
		const { cwd } = await setupShip();

		const result = await runShip({ cwd, settings, integration });

		expect(result.status).toBe('shipped');
	});
});
