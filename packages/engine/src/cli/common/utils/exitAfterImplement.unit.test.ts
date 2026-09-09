import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { contradictoryShipFlagsMessage } from '#src/cli/common/constants/contradictoryShipFlagsMessage.ts';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import { LightsoutConfig, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf } from '#tests/helpers/setupResume.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';

/** A passed implement run standing on a shippable branch, with a forge that answers as this test wants. */
const setupChain = ({
	ship,
	ok = true,
	checks = '[{"name":"unit","bucket":"pass"}]',
}: {
	ship?: Record<string, unknown>;
	ok?: boolean;
	checks?: string;
} = {}) => {
	const captured = captureCommandOutput();
	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'auth status': { exitCode: 0 },
			'pr list': { stdout: '[]' },
			'pr create': { stdout: 'https://forge.example/acme/repo/pull/41' },
			'pr edit': { exitCode: 0 },
			'pr view 41 --json number': { stdout: viewed },
			'pr view 41 --json headRefOid': { stdout: '{"headRefOid":"__HEAD__"}' },
			'pr view 41 --json state': {
				stdout: '{"state":"MERGED","mergeCommit":{"oid":"0f1e2d3c"},"headRefOid":"__HEAD__","mergeStateStatus":"CLEAN","reviewDecision":null}',
			},
			'pr checks': { stdout: checks },
			'pr merge': { exitCode: 0 },
		},
	});
	const { cwd } = setupBranchRepo({ branch: 'lo-60-ship' });
	const config = LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ...(ship === undefined ? {} : { ship }) });

	return { config, cwd, readForgeLog, result: { ok, manifest: manifestOf({ status: ok ? RunStatus.Passed : RunStatus.Failed }) }, ...captured };
};

/**
 * The same passed run and stubbed forge, standing on a branch whose remote
 * default branch has gained a commit of its own since the branch was cut.
 *
 * The commit touches a file the feature branch never wrote, so integrating it
 * is an ordinary merge — what is under test is whether the post-implement path
 * integrates at all, not what it does with a conflict.
 */
const setupMovedDefaultBranch = () => {
	const chain = setupChain();
	const origin = execSync('git remote get-url origin', { cwd: chain.cwd }).toString().trim();
	const upstream = mkdtempSync(join(tmpdir(), 'lightsout-upstream-'));

	execSync(`git clone -q ${origin} .`, { cwd: upstream, stdio: 'ignore' });
	execSync('git config user.name t && git config user.email t@t', { cwd: upstream, stdio: 'ignore' });
	writeFileSync(join(upstream, 'docs.md'), '# docs\n');
	execSync('git add -A && git commit -qm "document the release"', { cwd: upstream, stdio: 'ignore' });
	execSync('git push -q origin main', { cwd: upstream, stdio: 'ignore' });

	const defaultCommit = execSync('git rev-parse HEAD', { cwd: upstream }).toString().trim();

	return { ...chain, origin, defaultCommit };
};

describe('exitAfterImplement', () => {
	test('a passed run nobody asked to ship exits on its own result, touching no forge', async () => {
		const { config, cwd, result, readForgeLog, exitCodes } = setupChain();

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: false, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		expect(readForgeLog()).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a failed run never ships, even when the flag asked for it', async () => {
		const { config, cwd, result, readForgeLog, exitCodes } = setupChain({ ok: false });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: true, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		expect(readForgeLog()).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('the flag ships a passed run, and a shipped branch still exits on the run’s own result', async () => {
		const { config, cwd, result, readForgeLog, exitCodes } = setupChain();

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: true, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		expect(readForgeLog().some((line) => line.startsWith('pr merge'))).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('the config can ask for the same chain without the flag being typed', async () => {
		const { config, cwd, result, readForgeLog, exitCodes } = setupChain({ ship: { 'after-implement': true } });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: false, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		expect(readForgeLog().some((line) => line.startsWith('pr merge'))).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a ship that blocks after a passed run exits 1 — the code is verified, the merge is not done', async () => {
		const { config, cwd, result, exitCodes } = setupChain({ checks: '[{"name":"unit","bucket":"fail"}]' });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: true, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([1]);
	});

	test('--no-ship beats the config, so a repo with after-implement on can still end a run unshipped', async () => {
		const { config, cwd, result, readForgeLog, exitCodes } = setupChain({ ship: { 'after-implement': true } });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: false, noShipFlag: true, env: {} })).rejects.toThrow(/process\.exit/);

		expect(readForgeLog()).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--ship and --no-ship together are a loud usage error, touching no forge', async () => {
		const { config, cwd, result, readForgeLog, errors, exitCodes } = setupChain();

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: true, noShipFlag: true, env: {} })).rejects.toThrow(/process\.exit/);

		// the same sentence implementCommand says before the run starts, from the
		// one constant both read — a user who hits it either way is told one thing
		expect(errors).toStrictEqual([contradictoryShipFlagsMessage]);
		expect(readForgeLog()).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('LIGHTSOUT_NO_SHIP in the environment wins over the flag — a queue worker run ends on its own result', async () => {
		const { config, cwd, result, readForgeLog, exitCodes } = setupChain({ ship: { 'after-implement': true } });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: true, noShipFlag: false, env: { LIGHTSOUT_NO_SHIP: '1' } })).rejects.toThrow(
			/process\.exit/,
		);

		expect(readForgeLog()).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a ship asked for against an unusable ticket pattern is a loud usage error rather than a silent skip', async () => {
		const { config, cwd, result, readForgeLog, errors, exitCodes } = setupChain({ ship: { 'ticket-pattern': '^lo-\\d+' } });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: true, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		expect(errors.some((line) => line.includes('ship.ticket-pattern'))).toBe(true);
		expect(readForgeLog()).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('ships the post-implement branch through the integration step, and still refuses to ship a failed run', async () => {
		const { config, cwd, result, origin, defaultCommit, readForgeLog, exitCodes } = setupMovedDefaultBranch();

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: true, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		// The branch that reached the remote carries the default branch's newer
		// commit, which it can only do if the shared sequence merged it in first —
		// a post-implement path that shipped without the integration bundle would
		// have pushed the branch exactly as the run left it.
		expect(execSync('git rev-list refs/heads/lo-60-ship', { cwd: origin }).toString().trim().split('\n')).toContain(defaultCommit);
		expect(readForgeLog().some((line) => line.startsWith('pr merge'))).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});
});
