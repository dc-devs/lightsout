import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus, type StepRecord, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { createRun, writeRunManifest } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * The slice of a run the commit step is handed, as that step declares it —
 * structural, because the two pipelines that call it share no declared run type.
 */
interface CommittingRun {
	cwd: string;
	config: LightsoutConfig;
	current(): RunManifest;
	progress(message: string): void;
	update({ patch }: { patch: Partial<RunManifest> }): Promise<void>;
}

interface CommitRunWorkParams {
	run: CommittingRun;
	driver: Driver;
	address?: { reference: string; fallbackSubject: string; context: string; unit?: string };
	resumed: boolean;
}

// Mocked Imports
// -------------------------
// The harness, the repo's gates and the commit step are the three things a
// direct run drives, and each is another module's entry point with its own
// tests. Run state on disk is real, because the record a resumable run leaves
// is exactly what these cases are about.
const mockInvokeAgentWithContract =
	jest.fn<(params: { invocation: { prompt: string; systemPrompt: string }; allowedCommands?: string[] }) => Promise<AgentOutcome<WorkReport>>>();

jest.mock('#src/invoke/index.ts', () => ({
	invokeAgentWithContract: (params: { invocation: { prompt: string; systemPrompt: string }; allowedCommands?: string[] }) =>
		mockInvokeAgentWithContract(params),
}));
// -------------------------
const mockRunGates = jest.fn<(params: { step?: string; onProgress?: (message: string) => void }) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({
	runGates: (params: { step?: string; onProgress?: (message: string) => void }) => mockRunGates(params),
}));
// -------------------------
const mockCommitRunWork = jest.fn<(params: CommitRunWorkParams) => Promise<string | undefined>>();

jest.mock('#src/commit/index.ts', () => ({
	commitRunWork: (params: CommitRunWorkParams) => mockCommitRunWork(params),
}));
// -------------------------

const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };
const ticketBody = '# Drain the backlog\n\nBuild the thing.';

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [{ path: 'src/thing.ts', summary: 'built it' }],
	summary: 'built it',
	failures: [],
	...overrides,
});

const passedStep = ({ id }: { id: string }): StepRecord => ({ id, status: RunStatus.Passed, attempts: 1 });

/** The record a commit that was refused leaves behind — the reason a run can be failed with its gates still green. */
const refusedCommitStep: StepRecord = {
	id: 'commit',
	status: RunStatus.Failed,
	attempts: 1,
	error: 'the checkout holds changes this run did not make',
};

/**
 * The harness green, the gates green, and the commit step answering whatever
 * the case needs — with what it was handed recorded for the test to read.
 *
 * The status at the moment of the call is captured too, because "commits
 * before the run is stamped passed" can be read nowhere else afterwards.
 */
const armDirectRun = ({ uncommitted }: { uncommitted?: string }) => {
	const seen: { subject?: string; resumed?: boolean; statusAtCommit?: RunStatus } = {};

	mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report: reportOf() });
	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], timeouts: [], coordination: undefined });
	mockCommitRunWork.mockImplementation(({ run, address, resumed }) => {
		seen.subject = address?.fallbackSubject;
		seen.resumed = resumed;
		seen.statusAtCommit = run.current().status;

		return Promise.resolve(uncommitted);
	});

	return seen;
};

/** A consumer repo and a first direct run in it, with `uncommitted` the sentence the commit step answers — none, when the work is committed. */
const setupDirectCommit = ({ uncommitted }: { uncommitted?: string } = {}) => {
	const cwd = setupConsumerRepo();
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
	const seen = armDirectRun({ uncommitted });

	const run = () =>
		runDirectWork({
			cwd,
			ticketBody,
			ticketRef: 'LO-70',
			driver,
			driverName: 'claude-code',
			config,
			onProgress: () => undefined,
		});

	return { run, seen };
};

/**
 * A consumer repo holding a direct run whose gates already went green, ready to
 * be resumed: `status` is what the manifest records for the run itself, which a
 * run stopped at its commit and a run stamped passed answer differently.
 */
const setupResumedDirectCommit = async ({ status }: { status: RunStatus }) => {
	const cwd = setupConsumerRepo();
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
	const seen = armDirectRun({});
	const created = await createRun({
		cwd,
		plan: 'ticket.md',
		pipeline: PipelineKind.Direct,
		ticketRef: 'LO-70',
		driver: 'claude-code',
		config,
	});
	const existing = await writeRunManifest({
		cwd,
		manifest: {
			...created,
			status,
			currentStep: null,
			changedFiles: ['src/thing.ts'],
			steps: [passedStep({ id: 'implement' }), passedStep({ id: 'verify' }), ...(status === RunStatus.Failed ? [refusedCommitStep] : [])],
		},
	});

	const run = () =>
		runDirectWork({
			cwd,
			ticketBody,
			ticketRef: 'LO-70',
			driver,
			driverName: 'claude-code',
			config,
			existing,
			onProgress: () => undefined,
		});

	return { run, seen };
};

describe('runDirectWork', () => {
	test('commits a passing direct run under its ticket heading', async () => {
		const { run, seen } = setupDirectCommit();

		const result = await run();

		expect({ ok: result.ok, status: result.manifest.status, ...seen }).toStrictEqual({
			ok: true,
			status: RunStatus.Passed,
			subject: 'LO-70 Drain the backlog',
			resumed: false,
			// the commit is made while the run is still running: a commit that is
			// refused must be able to fail a run that was never stamped passed
			statusAtCommit: RunStatus.Running,
		});
	});

	test('fails a direct run that changed nothing without unrecording its gates', async () => {
		const { run } = setupDirectCommit({ uncommitted: 'the worker changed nothing' });

		const result = await run();

		expect({
			ok: result.ok,
			status: result.manifest.status,
			error: result.error,
			verify: result.manifest.steps.find((step) => step.id === 'verify')?.status,
			commit: result.manifest.steps.find((step) => step.id === 'commit')?.status,
		}).toStrictEqual({
			ok: false,
			status: RunStatus.Failed,
			error: 'the worker changed nothing',
			// the refusal is recorded under its own step, so the gates that did pass
			// stay passed and a resume pays for the commit alone
			verify: RunStatus.Passed,
			commit: RunStatus.Failed,
		});
	});

	test('takes a resumed passed run straight to its commit', async () => {
		const { run, seen } = await setupResumedDirectCommit({ status: RunStatus.Passed });

		const result = await run();

		expect({
			ok: result.ok,
			status: result.manifest.status,
			gates: mockRunGates.mock.calls.map((call) => call[0].step),
			workers: mockInvokeAgentWithContract.mock.calls.length,
			commits: mockCommitRunWork.mock.calls.length,
			resumed: seen.resumed,
			subject: seen.subject,
		}).toStrictEqual({ ok: true, status: RunStatus.Passed, gates: [], workers: 0, commits: 1, resumed: true, subject: 'LO-70 Drain the backlog' });
	});

	test('takes a run stopped at its commit straight back to it', async () => {
		const { run, seen } = await setupResumedDirectCommit({ status: RunStatus.Failed });

		const result = await run();

		// the manifest says failed and its verify step says passed: the step record
		// is what decides, so the person who stashed and resumed pays for the
		// commit rather than for the whole build again
		expect({
			ok: result.ok,
			status: result.manifest.status,
			gates: mockRunGates.mock.calls.map((call) => call[0].step),
			workers: mockInvokeAgentWithContract.mock.calls.length,
			commits: mockCommitRunWork.mock.calls.length,
			resumed: seen.resumed,
			subject: seen.subject,
		}).toStrictEqual({ ok: true, status: RunStatus.Passed, gates: [], workers: 0, commits: 1, resumed: true, subject: 'LO-70 Drain the backlog' });
	});

	test.each([
		{ entry: 'a first run', setup: () => Promise.resolve(setupDirectCommit()) },
		{ entry: 'a run re-entered with verify passed', setup: () => setupResumedDirectCommit({ status: RunStatus.Passed }) },
	])("hands the commit step the run's driver on a first run and on a re-entered one", async ({ setup }) => {
		const { run } = await setup();

		await run();

		// the commit-message agent runs on the harness the run already holds, so the
		// commit step must be handed that very driver on either way into it
		expect(mockCommitRunWork.mock.calls.map((call) => call[0])).toEqual([expect.objectContaining({ driver })]);
	});
});
