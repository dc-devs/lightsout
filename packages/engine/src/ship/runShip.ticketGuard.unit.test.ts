import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ShipMergeMethod } from '#src/contracts/index.ts';
import { runShip, type ShipTicketGuard } from '#src/ship/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';
const greenChecks = '[{"name":"unit","bucket":"pass"}]';

/** The pull request's head, answered from the checkout at call time — the candidate is whatever the sequence committed. */
const headView = '{"headRefOid":"__HEAD__"}';

/** The merge read-back for a merge the forge accepted. */
const mergedView = '{"state":"MERGED","mergeCommit":{"oid":"0f1e2d3c"},"headRefOid":"__HEAD__","mergeStateStatus":"CLEAN","reviewDecision":null}';

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

interface Params {
	/** Files left uncommitted, which is what a blocked precondition looks like. */
	dirty?: Record<string, string>;
	/** What the forge says the branch's checks did. Green by default. */
	checks?: string;
	/** What the ticket guard answers when it is asked: a sentence refuses, undefined authorizes. */
	refusal?: string;
}

/**
 * A branch, a real origin, a forge answering every call the sequence makes, and
 * a ticket guard whose two calls are recorded.
 *
 * Both members are spies rather than the shared no-op double, because every
 * case here is about which of them the sequence asked and with what.
 */
const setupTicketGuardShip = ({ dirty, checks, refusal }: Params = {}) => {
	const mockAuthorize = jest.fn<ShipTicketGuard['authorize']>();
	const mockRecordShipped = jest.fn<ShipTicketGuard['recordShipped']>();

	mockAuthorize.mockResolvedValue(refusal);
	mockRecordShipped.mockResolvedValue(undefined);

	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'auth status': { exitCode: 0 },
			'pr list': { stdout: '[]' },
			'pr create': { stdout: 'https://forge.example/acme/repo/pull/41' },
			'pr edit': { exitCode: 0 },
			'pr view 41 --json number': { stdout: viewed },
			'pr view 41 --json headRefOid,statusCheckRollup': { stdout: '', exitCode: 1 },
			'pr view 41 --json headRefOid': { stdout: headView },
			'pr view 41 --json state': { stdout: mergedView },
			'pr checks': { stdout: checks ?? greenChecks },
			'pr merge': { exitCode: 0 },
		},
	});

	const { cwd } = setupBranchRepo({ branch: 'lo-60-ship', dirty });

	const ship = () =>
		runShip({
			cwd,
			settings,
			integration,
			ticketGuard: { authorize: mockAuthorize, recordShipped: mockRecordShipped },
		});

	return { cwd, mockAuthorize, mockRecordShipped, readForgeLog, ship };
};

/** What origin holds for the branch — empty when nothing was ever pushed to it. */
const publishedBranch = ({ cwd }: { cwd: string }) => execSync('git ls-remote --heads origin lo-60-ship', { cwd, encoding: 'utf8' }).trim();

/** Whether the sequence filed a shipping progress record, which it only does once the preconditions and the ticket guard let it start. */
const hasProgressRecord = ({ cwd }: { cwd: string }) => existsSync(join(cwd, '.lightsout', 'tickets', 'lo-60-ship', 'ship-progress.json'));

// What the ticket record's say over shipping does to the sequence. What each
// step does to the branch is the sibling scenario files' subject.
describe('runShip', () => {
	test('blocks with ticket-not-authorized before any push when the ticket guard refuses', async () => {
		const { cwd, ship } = setupTicketGuardShip({ refusal: 'plan 002 of lo-60 is not implemented yet, so this ticket may not ship' });

		const result = await ship();

		expect(result).toEqual(
			expect.objectContaining({
				status: 'blocked',
				reason: 'ticket-not-authorized',
				detail: 'plan 002 of lo-60 is not implemented yet, so this ticket may not ship',
				branch: 'lo-60-ship',
				ticketRef: 'lo-60',
			}),
		);
		expect({ published: publishedBranch({ cwd }), progressRecord: hasProgressRecord({ cwd }) }).toStrictEqual({
			published: '',
			progressRecord: false,
		});
	});

	test('does not ask the ticket guard when a precondition already stopped the ship', async () => {
		const { mockAuthorize, ship } = setupTicketGuardShip({ dirty: { 'brainstorm-notes.md': 'half a thought\n' } });

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'dirty-tree' }));
		expect(mockAuthorize).not.toHaveBeenCalled();
	});

	test('records the merge on the ticket through the guard exactly when the ship merged', async () => {
		const merged = setupTicketGuardShip();

		const shipped = await merged.ship();

		expect(shipped).toEqual(expect.objectContaining({ status: 'shipped', mergeCommit: '0f1e2d3c' }));
		expect(merged.mockRecordShipped).toHaveBeenCalledTimes(1);
		expect(merged.mockRecordShipped).toHaveBeenCalledWith({ cwd: merged.cwd, branch: 'lo-60-ship', mergeCommit: '0f1e2d3c' });

		const stopped = setupTicketGuardShip({ checks: '[{"name":"unit","bucket":"fail"}]' });

		const blocked = await stopped.ship();

		expect(blocked).toEqual(expect.objectContaining({ status: 'blocked', reason: 'checks-failed' }));
		expect(stopped.mockRecordShipped).not.toHaveBeenCalled();
	});
});
