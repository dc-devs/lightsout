import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementDirectCommand } from '#src/cli/implementDirectCommand.ts';
import { PipelineKind, PlanProgress, RunStatus, TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { readTicketRecord, updateLocalTicketRecord } from '#src/ticket/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { seedRunFolder } from '#tests/helpers/seedRunFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf } from '#tests/helpers/setupResume.ts';

// Mocked Imports
// -------------------------
// The build has its own tests, and the commit it ends on is the run's own
// rather than this command's; what this file pins is what a build from the
// ticket body writes to the ticket record around it. The build answers under
// whatever run id it is handed, which is how a run created under a pre-minted
// id behaves.
const mockRunDirectWork = jest.fn<(params: { ticketBody: string; ticketRef: string; runId?: string; willShip?: boolean }) => Promise<PipelineResult>>();

jest.mock('#src/direct/index.ts', () => ({
	runDirectWork: (params: { ticketBody: string; ticketRef: string; runId?: string; willShip?: boolean }) => mockRunDirectWork(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch the build stands on. */
const ticketBranch = 'lo-140-multi';
const planId = '001-drain-the-backlog';
const createdAt = '2026-01-01T00:00:00.000Z';

/** The id the build answers under when nobody handed it one — a run the record could not have named in advance. */
const unmintedRunId = 'run-direct-unminted';

const recordOf = ({ mode, progress }: { mode: TicketMode; progress: PlanProgress }): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode,
	plans: [{ id: planId, title: 'Drain the backlog', progress, createdAt }],
	history: [{ at: createdAt, kind: TicketEventKind.PlanAdded, detail: `added plan ${planId}` }],
});

/** Plan 001 as the record holds it now, or undefined when the record cannot be read. */
const planIn = ({ read }: { read: { record: TicketRecord | undefined } | { error: string } }) =>
	'error' in read ? undefined : read.record?.plans.find((plan) => plan.id === planId);

/**
 * A committed ticket branch whose record is in the checkout's own `.lightsout`,
 * with the build and the commit stubbed green.
 *
 * `runIds` collects the id each build actually ran under, so a row can say the
 * record names the run that exists rather than restating an id of its own.
 */
const setupBodyBuild = async ({
	mode,
	progress = PlanProgress.Planning,
	corrupt = false,
}: {
	mode: TicketMode;
	/** How far plan 001's implementation has already got when the build starts. */
	progress?: PlanProgress;
	/** Whether the written record is then replaced by bytes that are not a record at all. */
	corrupt?: boolean;
}) => {
	const captured = captureCommandOutput();
	const { cwd } = setupBranchRepo({ branch: ticketBranch });
	const runIds: string[] = [];

	// Run state is ignored the way a consumer repo ignores it: the run ends in
	// `git add -A`, and the record beside it must not read as a dirty tree.
	writeFileSync(join(cwd, '.gitignore'), '.lightsout/\n');
	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false } }));
	writeFileSync(join(cwd, 'ticket.md'), '# Drain the backlog\n\nBuild the thing.\n');
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm setup', { cwd, stdio: 'ignore' });

	const seeded = recordOf({ mode, progress });
	const written = await updateLocalTicketRecord({ cwd, ticketBranch, change: () => seeded });

	if ('error' in written) {
		throw new Error(written.error);
	}

	const recordPath = join(cwd, '.lightsout', 'tickets', ticketBranch, 'ticket.json');

	if (corrupt) {
		writeFileSync(recordPath, '{ half a record');
	}

	mockRunDirectWork.mockImplementation(async ({ runId }) => {
		runIds.push(runId ?? unmintedRunId);
		// The build is stubbed, so the run folder a real `createRun` would have
		// made is planted here — the command resolves the run's directory by id.
		seedRunFolder({ cwd, runId: runId ?? unmintedRunId, pipeline: 'direct' });

		return { ok: true, manifest: manifestOf({ runId: runId ?? unmintedRunId, status: RunStatus.Passed, pipeline: PipelineKind.Direct }) };
	});

	return { context: { flags: parseFlags({ args: ['--ticket', 'ticket.md', '--no-worktree'] }), rest: [], cwd }, cwd, seeded, runIds, ...captured };
};

describe('implementDirectCommand ticket plan lifecycle', () => {
	test('records a body build of single-plan plan 001 through the lifecycle helper and leaves a multiple-plan record alone', async () => {
		const single = await setupBodyBuild({ mode: TicketMode.SinglePlan });

		await expect(implementDirectCommand(single.context)).rejects.toThrow(/process\.exit/);

		const singleRecord = await readTicketRecord({ cwd: single.cwd, ticketBranch });
		const multiple = await setupBodyBuild({ mode: TicketMode.MultiplePlan });

		await expect(implementDirectCommand(multiple.context)).rejects.toThrow(/process\.exit/);

		const multipleRecord = await readTicketRecord({ cwd: multiple.cwd, ticketBranch });

		// single-plan mode means plan 001 supplies the implementation however it is
		// built, so the body build is recorded under the run it actually created —
		// otherwise the ship guard would refuse a ticket that is fully implemented
		expect(planIn({ read: singleRecord })).toEqual(
			expect.objectContaining({ progress: PlanProgress.Implemented, implementation: expect.objectContaining({ runId: single.runIds[0] }) }),
		);
		// a multiple-plan ticket builds every plan from its own plan deliverable, so
		// a build from the ticket body is none of its plans' implementation
		expect(multipleRecord).toStrictEqual({ record: multiple.seeded });
		expect(multiple.runIds).toStrictEqual([unmintedRunId]);
	});

	test('leaves the record alone when single-plan plan 001 is already implemented', async () => {
		const { context, cwd, seeded, runIds } = await setupBodyBuild({ mode: TicketMode.SinglePlan, progress: PlanProgress.Implemented });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// the plan's implementation already finished, so this build is not it: the
		// command runs as it always has, under an id nobody minted for it, and the
		// finish already on the record is not overwritten by a second one
		expect(await readTicketRecord({ cwd, ticketBranch })).toStrictEqual({ record: seeded });
		expect(runIds).toStrictEqual([unmintedRunId]);
	});

	test("refuses to build when the branch's ticket record cannot be read", async () => {
		const { context, runIds, errors, exitCodes } = await setupBodyBuild({ mode: TicketMode.SinglePlan, corrupt: true });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// a record nobody can read cannot say whether this build is plan 001's
		// implementation, and building first would leave that unanswerable
		expect(errors.join('\n')).toContain('ticket.json');
		expect(runIds).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});
});
