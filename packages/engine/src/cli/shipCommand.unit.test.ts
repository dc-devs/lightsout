import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { shipCommand } from '#src/cli/shipCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';

/**
 * A tracker block naming a credential no environment ever holds, so the Done
 * write that follows a merge fails before it can reach a network — the failure
 * path this file needs, without a mock and without planting a real key.
 */
const unreachableTracker = {
	provider: 'linear',
	team: 'LO',
	'api-key-env': 'LIGHTSOUT_SHIP_RECONCILE_ABSENT_KEY',
};

/** A repo whose config carries the ship block under test, and a forge that answers every call. */
const setupShipCommand = ({
	ship,
	checks = '[{"name":"unit","bucket":"pass"}]',
	dirty,
	tracker,
}: {
	ship?: Record<string, unknown>;
	checks?: string;
	/** Files left uncommitted after the config is committed — what a dirty tree looks like. */
	dirty?: Record<string, string>;
	/** The `ticket-tracker` block, when the test wants the merge reconciled to Done. */
	tracker?: Record<string, unknown>;
} = {}) => {
	const captured = captureCommandOutput();

	stubForgeOnPath({
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

	writeFileSync(
		join(cwd, 'lightsout.config.json'),
		JSON.stringify({
			gates: { check: 'true', test: 'true', 'test-coverage': false },
			...(ship === undefined ? {} : { ship }),
			...(tracker === undefined ? {} : { 'ticket-tracker': tracker }),
		}),
	);
	// Committed, not just written: an untracked config would be the dirty tree
	// ship blocks on, and every test here would stop on that instead.
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm config', { cwd, stdio: 'ignore' });

	// Written after the commit, so these are the only thing the tree is dirty with.
	for (const [path, content] of Object.entries(dirty ?? {})) {
		writeFileSync(join(cwd, path), content);
	}

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

describe('shipCommand', () => {
	test('a branch that ships names the pull request, the merge commit and its URL, and exits 0', async () => {
		const { context, errors, logged, exitCodes } = setupShipCommand({ ship: { 'ticket-pattern': '^(?<ticket>lo-(?<number>\\d+))' } });

		await expect(shipCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.some((line) => line.includes('shipped lo-60') && line.includes('#41') && line.includes('0f1e2d3c'))).toBe(true);
		expect(logged).toContain('  https://forge.example/acme/repo/pull/41');
		// A repo that named no tracker never asked for the Done write, so the
		// shipped path says nothing about one.
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a ship whose tracker cannot be reached prints why the ticket is not Done, and still exits 0', async () => {
		const { context, errors, logged, exitCodes } = setupShipCommand({
			ship: { 'ticket-pattern': '^(?<ticket>lo-(?<number>\\d+))' },
			tracker: unreachableTracker,
		});

		await expect(shipCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.some((line) => line.includes('lo-60') && line.includes('LIGHTSOUT_SHIP_RECONCILE_ABSENT_KEY'))).toBe(true);
		// The merge happened, so the shipped lines and the exit code are the ones
		// a successful ship always writes — a stale ticket cannot unship a branch.
		expect(logged.some((line) => line.includes('shipped lo-60') && line.includes('0f1e2d3c'))).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a blocked ship names the reason, the failing checks and the result file, and exits 1', async () => {
		const { context, errors, logged, exitCodes } = setupShipCommand({ checks: '[{"name":"unit","bucket":"fail"}]' });

		await expect(shipCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.some((line) => line.includes('checks-failed'))).toBe(true);
		expect(errors).toContain('  checks: unit');
		expect(logged.some((line) => line.includes(join('.lightsout', 'ship', 'lo-60-ship.json')))).toBe(true);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a block that named no checks prints no checks line, so a reader is never handed an empty list to chase', async () => {
		const { context, errors, logged, exitCodes } = setupShipCommand({ dirty: { 'brainstorm-notes.md': '# uncommitted\n' } });

		await expect(shipCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.some((line) => line.includes('dirty-tree') && line.includes('brainstorm-notes.md'))).toBe(true);
		expect(errors.some((line) => line.startsWith('  checks:'))).toBe(false);
		// the run still happened, so it still left the result file a tracker skill reads
		expect(logged.some((line) => line.includes(join('.lightsout', 'ship', 'lo-60-ship.json')))).toBe(true);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a ticket pattern that cannot capture a ticket is a startup usage error, and no run is recorded for it', async () => {
		const { context, errors, logged, exitCodes } = setupShipCommand({ ship: { 'ticket-pattern': '^lo-\\d+' } });

		await expect(shipCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.some((line) => line.includes('ship.ticket-pattern'))).toBe(true);
		expect(logged).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});
});
