import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { readWorkOrderTicketRef } from '#src/workOrder/readWorkOrderTicketRef.ts';

// Mocked Imports
// -------------------------
// The branch read has its own test and shells out to git. What this file owns
// is which record the branch leads to, and what that record answers.
const mockReadGitCurrentBranch = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/common/git/readGitCurrentBranch.ts', () => ({
	readGitCurrentBranch: (params: { cwd: string }) => mockReadGitCurrentBranch(params),
}));
// -------------------------

/**
 * A state the contract accepts, written by hand so the read is the only thing
 * under test. `branch` is stated apart from `name` because a prefixed
 * `queue.branch-template` stores one the label does not spell, and `ticketRef`
 * carries the tracker's own capitals.
 */
const workOrderStateOf = ({ name, branch, ticketRef }: { name: string; branch: string; ticketRef: string }) => ({
	schemaVersion: 1,
	name,
	branch,
	ticketRef,
	mode: 'multiple-plan',
	plans: [],
	history: [],
});

/**
 * A checkout with no repository above it, holding one work order whose branch
 * carries a prefix, on whichever branches the test names in turn.
 */
const setupCheckout = ({ branches }: { branches: (string | undefined)[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-read-work-order-ticket-ref-'));
	const folder = join(cwd, '.lightsout', 'work-orders', 'lo-158-give-the-name-one');

	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, 'state.json'),
		JSON.stringify(workOrderStateOf({ name: 'lo-158-give-the-name-one', branch: 'feature/lo-158-give-the-name-one', ticketRef: 'LO-158' })),
	);

	for (const branch of branches) {
		mockReadGitCurrentBranch.mockResolvedValueOnce(branch);
	}

	return { cwd };
};

describe('readWorkOrderTicketRef', () => {
	// The claimed branch proves the pattern is out of the picture twice over:
	// the default `^(?<ticket>[a-z]+-\d+)` cannot read a branch that starts
	// with `feature/`, and could never answer the capitals the tracker spells.
	test("answers the record's ticket reference, and undefined when no work order claims the branch", async () => {
		const { cwd } = setupCheckout({ branches: ['feature/lo-158-give-the-name-one', 'lo-999-nobody-claims-this'] });

		const claimed = await readWorkOrderTicketRef({ cwd });
		const unclaimed = await readWorkOrderTicketRef({ cwd });

		expect({ claimed, unclaimed }).toEqual({ claimed: 'LO-158', unclaimed: undefined });
	});
});
