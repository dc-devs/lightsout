import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf, runId, setupResume } from '#tests/helpers/setupResume.ts';

// Mocked Imports
// -------------------------
// What this file pins is how resume continues a DIRECT run: which checkout each
// remaining step acts on, and that the commit is the run's own rather than this
// edge's. The worker spawns a harness, the commit writes git history and the
// ship tail leaves the machine — each covered by its own tests. Both halves of
// the commit module are stubbed, so a commit made anywhere at this edge would
// be seen rather than silently succeed.
type DirectWorkParams = { cwd: string; ticketBody: string; ticketRef: string; existing?: RunManifest };
type CommitParams = {
	cwd: string;
	composeMessage: ({ cwd }: { cwd: string }) => Promise<string>;
	runDir: string;
	generated: string[] | undefined;
	onProgress: (message: string) => void;
};
type CommitRunWorkParams = {
	run: {
		cwd: string;
		config: LightsoutConfig;
		current: () => RunManifest;
		progress: (message: string) => void;
		update: (params: { patch: Partial<RunManifest> }) => Promise<void>;
	};
	subject?: string;
	resumed: boolean;
};
type GuardParams = { cwd: string; config: LightsoutConfig; env: NodeJS.ProcessEnv; ticketRef?: string; onProgress?: (message: string) => void };
type ExitAfterImplementParams = {
	config: LightsoutConfig;
	cwd: string;
	result: PipelineResult;
	shipFlag: boolean;
	noShipFlag: boolean;
	env: NodeJS.ProcessEnv;
};

const mockRunDirectWork = jest.fn<(params: DirectWorkParams) => Promise<PipelineResult>>();

jest.mock('#src/direct/index.ts', () => ({ runDirectWork: (params: DirectWorkParams) => mockRunDirectWork(params) }));
// -------------------------
const mockCommitRunWork = jest.fn<(params: CommitRunWorkParams) => Promise<string | undefined>>();
const mockCommitTicketWork = jest.fn<(params: CommitParams) => Promise<{ committed: false } | { committed: true; message: string } | { error: string }>>();

jest.mock('#src/commit/index.ts', () => ({
	...jest.requireActual<typeof import('#src/commit/index.ts')>('#src/commit/index.ts'),
	commitRunWork: (params: CommitRunWorkParams) => mockCommitRunWork(params),
	commitWorkOrderWork: (params: CommitParams) => mockCommitTicketWork(params),
}));
// -------------------------
const mockRequireImplementLifecycle = jest.fn<(params: GuardParams) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: GuardParams) => mockRequireImplementLifecycle(params),
}));
// -------------------------
const mockExitAfterImplement = jest.fn<(params: ExitAfterImplementParams) => Promise<void>>();

jest.mock('#src/cli/common/utils/exitAfterImplement.ts', () => ({
	exitAfterImplement: (params: ExitAfterImplementParams) => mockExitAfterImplement(params),
}));
// -------------------------

/** The branch the seeded run was built on, and the one its ownership record is keyed by. */
const branch = 'lo-70-drain';

/** The ticket body frozen beside the run by the invocation that started it — the input a resume must not re-derive. */
const ticketBody = '# Drain the backlog\n\nBuild the thing.\n';

/** Where that frozen ticket sits, relative to the checkout the run's records live in. */
const frozenTicketPath = join('.lightsout', 'direct', 'runs', runId, 'ticket.md');

/**
 * A parked direct run: its records in the checkout the command is launched
 * from, its work in a second checkout the manifest records as the workspace.
 *
 * `dirty` is what the workspace holds uncommitted when resume finds it, and
 * `recorded` is what the manifest already says the run itself touched — the run
 * carries both down to the commit step, which is where every dirty-tree
 * judgment now happens.
 */
const setupDirectResume = async ({
	status,
	dirty,
	recorded = {},
	withTicket = true,
	withTicketRef = true,
}: {
	status: RunStatus;
	/** Files left uncommitted in the workspace, by repo-relative name. */
	dirty?: Record<string, string>;
	/** What the manifest records as the run's own work: the files it changed, and the files already dirty when it started. */
	recorded?: { changedFiles?: string[]; baselineDirtyFiles?: string[] };
	/** Whether the frozen ticket is still on disk beside the run; false leaves the recorded path pointing at nothing. */
	withTicket?: boolean;
	/** Whether the manifest recorded a ticket reference; false is a run started on a branch whose ticket the pattern never read. */
	withTicketRef?: boolean;
}) => {
	const { cwd: workspace } = setupBranchRepo({ branch, dirty });
	const seeded = setupResume({
		args: ['--run', runId],
		manifest: manifestOf({
			pipeline: PipelineKind.Direct,
			status,
			plan: frozenTicketPath,
			ticketRef: withTicketRef ? 'lo-70' : undefined,
			branch,
			workspace,
			changedFiles: recorded.changedFiles ?? [],
			baselineDirtyFiles: recorded.baselineDirtyFiles ?? [],
		}),
	});

	if (withTicket) {
		mkdirSync(dirname(join(seeded.cwd, frozenTicketPath)), { recursive: true });
		writeFileSync(join(seeded.cwd, frozenTicketPath), ticketBody);
	}

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf({ pipeline: PipelineKind.Direct, status: RunStatus.Passed, workspace, branch }) });
	mockCommitTicketWork.mockResolvedValue({ committed: true, message: 'LO-70: stub subject\n\nlightsout run stub\n' });
	mockExitAfterImplement.mockResolvedValue(undefined);

	return { workspace, ...seeded };
};

describe('resumeCommand direct runs', () => {
	test('a failed direct run is continued here, keeping its run id and its frozen ticket', async () => {
		const { context, workspace, errors } = await setupDirectResume({ status: RunStatus.Failed });

		await resumeCommand(context);

		// the run is continued in the tree it recorded, under its own id, from the
		// ticket frozen beside it — never sent back to `implement-direct`
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, ticketBody, existing: expect.objectContaining({ runId }) }));
		expect(errors).toStrictEqual([]);
	});

	test('a direct run that passed but never committed goes back to its own pipeline and then ships', async () => {
		const { context, workspace } = await setupDirectResume({
			status: RunStatus.Passed,
			dirty: { 'feature.ts': 'export const feature = 1;\n' },
			recorded: { changedFiles: ['feature.ts'] },
		});

		await resumeCommand(context);

		// the pipeline decides from the run's own step records what is left — a
		// run whose gates are green goes straight to its commit — so the edge hands
		// every status back to it and ships on what it answers
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, existing: expect.objectContaining({ runId }) }));
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, result: expect.objectContaining({ ok: true }) }));
	});

	test('a direct run that already committed re-ships instead of being refused for an empty commit', async () => {
		const { context, workspace, errors } = await setupDirectResume({ status: RunStatus.Passed });

		await resumeCommand(context);

		// a clean workspace means the commit already landed and only the ship
		// failed, which is not the worker having changed nothing — and the edge
		// itself never stages anything either way
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(errors).toStrictEqual([]);
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, result: expect.objectContaining({ ok: true }) }));
	});

	test('a continued run that fails again leaves its tree uncommitted for the next resume', async () => {
		const { context, errors } = await setupDirectResume({ status: RunStatus.Failed, dirty: { 'feature.ts': 'export const feature = 1;\n' } });

		mockRunDirectWork.mockResolvedValue({
			ok: false,
			manifest: manifestOf({ pipeline: PipelineKind.Direct, status: RunStatus.Failed }),
			error: 'tsc: 3 errors',
		});

		await resumeCommand(context);

		// the same rule a first run follows: a build that did not pass is never
		// committed, so the partial work stays in the tree for the next attempt
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: false }) }));
		// what the reader is told is why the build stopped, not a commit refusal
		expect(errors.join('\n')).toContain('tsc: 3 errors');
	});

	test('a run that recorded no reference is continued under the branch it was built on', async () => {
		const { context } = await setupDirectResume({
			status: RunStatus.Passed,
			dirty: { 'feature.ts': 'export const feature = 1;\n' },
			recorded: { changedFiles: ['feature.ts'] },
			withTicketRef: false,
		});

		await resumeCommand(context);

		// the reference prefixes the commit subject the run makes for itself, so a
		// run whose branch carried no ticket the pattern read is still named after
		// something a human recognises rather than a placeholder
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'lo-70-drain' }));
	});

	test('resumes a direct run without committing at the command edge', async () => {
		const { context, workspace, errors, exitCodes } = await setupDirectResume({
			status: RunStatus.Passed,
			recorded: { changedFiles: ['feature.ts'] },
		});

		await resumeCommand(context);

		// the run's own pipeline owns the commit now, so the edge hands the run
		// back to it and stages nothing itself — and the clean tree a run that
		// already committed leaves behind is not a reason to refuse the resume
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, existing: expect.objectContaining({ runId }) }));
		expect(mockCommitRunWork).not.toHaveBeenCalled();
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([]);
	});

	test('a direct run whose frozen ticket has gone names the path and stops', async () => {
		const { context, errors, exitCodes } = await setupDirectResume({ status: RunStatus.Failed, withTicket: false });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(frozenTicketPath);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});
