import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementDirectCommand } from '#src/cli/implementDirectCommand.ts';
import { type LightsoutConfig, RunStatus } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import type { QueueFailure } from '#src/queue/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf } from '#tests/helpers/setupResume.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

// Mocked Imports
// -------------------------
// The build and the commit are covered by their own tests; what this file pins
// is the tracker write the command requires before either of them, and the one
// that follows the merge at its exit.
const mockRunDirectWork = jest.fn<(params: { ticketBody: string; ticketRef: string; willShip?: boolean }) => Promise<PipelineResult>>();
const mockCommitTicketWork = jest.fn<(params: { message: string; runDir: string }) => Promise<{ committed: boolean } | QueueFailure>>();

jest.mock('#src/direct/index.ts', () => ({
	runDirectWork: (params: { ticketBody: string; ticketRef: string; willShip?: boolean }) => mockRunDirectWork(params),
}));
jest.mock('#src/queue/index.ts', () => ({ commitTicketWork: (params: { message: string; runDir: string }) => mockCommitTicketWork(params) }));
// -------------------------
interface GuardParams {
	cwd: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	ticketRef?: string;
	onProgress?: (message: string) => void;
}

interface ReconcileParams {
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	ticketRef: string | undefined;
	onProgress?: (message: string) => void;
}

const mockRequireImplementLifecycle = jest.fn<(params: GuardParams) => Promise<string | undefined>>();
const mockReconcileShippedTicket = jest.fn<(params: ReconcileParams) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: GuardParams) => mockRequireImplementLifecycle(params),
	reconcileShippedTicket: (params: ReconcileParams) => mockReconcileShippedTicket(params),
}));
// -------------------------

/** The sentence a guard that cannot make the pre-source write answers with. */
const refusalSentence =
	"LO-99 could not be moved to 'In Progress' with planning status 'planning-complete': the tracker refused — implement records the ticket's state before it changes any source, so the run stops here";

/** The sentence the post-merge reconciler answers with when the Done write did not land. */
const reconciliationSentence = "lo-70 shipped, but its tracker status could not be moved to 'Done': the tracker refused";

/** The pull request the stubbed forge reports once it has been opened. */
const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Drain the backlog","headRefName":"lo-70-drain"}';

/** What the stubbed forge answers, so a passed run can chain all the way through a real merge. */
const forgeResponses = {
	'auth status': { exitCode: 0 },
	'pr list': { stdout: '[]' },
	'pr create': { stdout: 'https://forge.example/acme/repo/pull/41' },
	'pr edit': { exitCode: 0 },
	'pr view 41 --json number': { stdout: viewed },
	'pr view 41 --json mergeCommit': { stdout: '{"mergeCommit":{"oid":"0f1e2d3c"}}' },
	'pr checks': { stdout: '[{"name":"unit","bucket":"pass"}]' },
	'pr merge': { exitCode: 0 },
};

/**
 * A committed branch carrying a ticket file, with the build and the commit
 * stubbed green and the forge answering from the table above.
 *
 * `dirty` leaves a file uncommitted, which is the one refusal that lands before
 * the guard runs. LIGHTSOUT_NO_SHIP is pinned empty because a queue worker
 * exports it and it silently beats both the flag and the config; restoreMocks
 * puts the real environment back after every test.
 */
const setupDirectLifecycle = ({
	args,
	refusal,
	reconciliation,
	dirty,
}: {
	args: string[];
	/** What the pre-source guard answers, or undefined to permit the run. */
	refusal?: string;
	/** What the post-merge reconciler answers, or undefined when the Done write landed. */
	reconciliation?: string;
	/** A file left uncommitted after the ticket file is committed. */
	dirty?: string;
}) => {
	const captured = captureCommandOutput();
	const { readForgeLog } = stubForgeOnPath({ responses: forgeResponses });
	const { cwd } = setupBranchRepo({ branch: 'lo-70-drain' });

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false } }));
	writeFileSync(join(cwd, 'ticket.md'), '# Drain the backlog\n\nBuild the thing.\n');
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm setup', { cwd, stdio: 'ignore' });

	if (dirty !== undefined) {
		writeFileSync(join(cwd, 'stray.ts'), dirty);
	}

	mockRequireImplementLifecycle.mockResolvedValue(refusal);
	mockReconcileShippedTicket.mockResolvedValue(reconciliation);
	mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf({ status: RunStatus.Passed }) });
	mockCommitTicketWork.mockResolvedValue({ committed: true });
	jest.replaceProperty(process, 'env', { ...process.env, LIGHTSOUT_NO_SHIP: '' });

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, readForgeLog, ...captured };
};

describe('implementDirectCommand pre-source lifecycle guard', () => {
	test('a required pre-source write that could not be made stops the run before the build, in the guard’s own words', async () => {
		const { context, errors, exitCodes } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md', '--ref', 'LO-99'], refusal: refusalSentence });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual([refusalSentence]);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('the guard is handed the --ref that was typed', async () => {
		const { context, cwd } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md', '--ref', 'LO-99'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRequireImplementLifecycle).toHaveBeenCalledWith(expect.objectContaining({ cwd, ticketRef: 'LO-99' }));
	});

	test('without --ref the guard is handed no reference at all, so it reads the branch rather than the run’s label', async () => {
		const { context } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// the run's own label falls back to the branch name, which is not a ticket
		// reference — handing it to the guard would ask the tracker about a branch
		expect(mockRequireImplementLifecycle).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: undefined }));
	});

	test('the run’s label is still derived from the branch, even though the guard was told nothing', async () => {
		const { context } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'lo-70' }));
	});

	test('a dirty tree is refused before the tracker is touched, so a run that never starts leaves no ticket saying it did', async () => {
		const { context, errors, exitCodes } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md'], dirty: 'export const stray = 1;\n' });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['implement-direct commits everything in the tree; commit or stash your changes first']);
		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});

describe('implementDirectCommand post-merge reconciliation', () => {
	test('reconciles the branch’s own ticket once the merge is confirmed', async () => {
		const { context, readForgeLog } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md', '--ship'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// the merge is what the Done write is evidence of, so the reconciler runs
		// after it and is named the reference the ship itself reported
		expect(readForgeLog().some((line) => line.startsWith('pr merge'))).toBe(true);
		expect(mockReconcileShippedTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'lo-70' }));
	});

	test('a Done write that did not land is printed beside the ship, and the run still exits on its own result', async () => {
		const { context, errors, exitCodes } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md', '--ship'], reconciliation: reconciliationSentence });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// a tracker failure cannot undo a merge that already happened, so the
		// stale tracker state is visible and the exit code stays on the merge's side
		expect(errors).toContain(reconciliationSentence);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a reconciler that answers nothing adds nothing to the shipped run’s output', async () => {
		const { context, errors, exitCodes } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md', '--ship'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.some((line) => line.includes('shipped, but'))).toBe(false);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a run nobody asked to ship never reaches the reconciler, because nothing merged', async () => {
		const { context, readForgeLog, exitCodes } = setupDirectLifecycle({ args: ['--ticket', 'ticket.md'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(readForgeLog()).toStrictEqual([]);
		expect(mockReconcileShippedTicket).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});
});
