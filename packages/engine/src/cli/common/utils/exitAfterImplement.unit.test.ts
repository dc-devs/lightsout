import { describe, expect, test } from '@jest/globals';
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
			'pr view 41 --json mergeCommit': { stdout: '{"mergeCommit":{"oid":"0f1e2d3c"}}' },
			'pr checks': { stdout: checks },
			'pr merge': { exitCode: 0 },
		},
	});
	const { cwd } = setupBranchRepo({ branch: 'lo-60-ship' });
	const config = LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ...(ship === undefined ? {} : { ship }) });

	return { config, cwd, readForgeLog, result: { ok, manifest: manifestOf({ status: ok ? RunStatus.Passed : RunStatus.Failed }) }, ...captured };
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

		expect(errors.some((line) => line.includes('--ship and --no-ship contradict'))).toBe(true);
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
});
