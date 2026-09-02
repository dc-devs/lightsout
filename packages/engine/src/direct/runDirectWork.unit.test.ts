import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, RunStatus, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The harness and the repo's gates are the two things a direct run drives, and
// each is another module's entry point with its own tests. Run state on disk is
// real, because a truthful, resumable record is what this run exists to leave.
const mockInvokeAgentWithContract = jest.fn<(params: { invocation: { prompt: string; systemPrompt: string } }) => Promise<AgentOutcome<WorkReport>>>();
const mockRunGates = jest.fn<(params: { step?: string; onProgress?: (message: string) => void }) => Promise<GateRunResult>>();

jest.mock('#src/invoke/index.ts', () => ({
	invokeAgentWithContract: (params: { invocation: { prompt: string; systemPrompt: string } }) => mockInvokeAgentWithContract(params),
}));
jest.mock('#src/gates/index.ts', () => ({
	runGates: (params: { step?: string; onProgress?: (message: string) => void }) => mockRunGates(params),
}));
// -------------------------

const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [{ path: 'src/thing.ts', summary: 'built it' }],
	summary: 'built it',
	failures: [],
	...overrides,
});

/** A consumer repo with the harness and the gates stubbed green. */
const setupDirectRun = () => {
	const cwd = setupConsumerRepo();
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

	mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report: reportOf() });
	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [] });

	const run = ({
		answeredQuestion,
		onProgress,
		ticketBody = '# Drain the backlog\n\nBuild the thing.',
		willShip,
	}: {
		answeredQuestion?: { question: string; answer: string };
		onProgress?: (message: string) => void;
		ticketBody?: string;
		willShip?: boolean;
	} = {}) =>
		runDirectWork({
			cwd,
			ticketBody,
			ticketRef: 'LO-70',
			driver,
			driverName: 'claude-code',
			config,
			answeredQuestion,
			willShip,
			onProgress,
		});

	return { cwd, run };
};

describe('runDirectWork', () => {
	test('runs the repo’s gates before any agent, builds, verifies, and ends passed', async () => {
		const { run } = setupDirectRun();

		const result = await run();

		expect(result.ok).toBe(true);
		expect(result.manifest.status).toBe(RunStatus.Passed);
		expect(mockRunGates.mock.calls.map((call) => call[0].step)).toStrictEqual(['pre-flight', 'verify']);
	});

	test('records the ticket on the manifest and keeps its body beside the run, because that is the document the run was built from', async () => {
		const { cwd, run } = setupDirectRun();

		const result = await run();

		expect(result.manifest.ticketRef).toBe('LO-70');
		expect(result.manifest.pipeline).toBe('direct');
		expect(readFileSync(`${getRunDir({ cwd, runId: result.manifest.runId })}/ticket.md`, 'utf8')).toBe('# Drain the backlog\n\nBuild the thing.\n');
	});

	test('records the ship intent it was started with, so the progress view can draw a ship row for a direct run too', async () => {
		const { run } = setupDirectRun();

		expect((await run({ willShip: true })).manifest.willShip).toBe(true);
	});

	test('a direct run nobody asked to ship records no intent at all', async () => {
		const { run } = setupDirectRun();

		expect((await run()).manifest.willShip).toBeUndefined();
	});

	test('writes a ticket body that already ends in a newline without adding a second one', async () => {
		const { cwd, run } = setupDirectRun();

		const result = await run({ ticketBody: '# Drain the backlog\n' });

		expect(readFileSync(`${getRunDir({ cwd, runId: result.manifest.runId })}/ticket.md`, 'utf8')).toBe('# Drain the backlog\n');
	});

	test('merges the agent’s changed files into the manifest, which is what the run reports afterwards', async () => {
		const { run } = setupDirectRun();

		expect((await run()).manifest.changedFiles).toStrictEqual(['src/thing.ts']);
	});

	test('stops before spending an agent when the repo is not green to begin with — a red gate then is not the agent’s doing', async () => {
		const { run } = setupDirectRun();

		mockRunGates.mockResolvedValue({ error: 'tsc: 3 errors', failedFamilies: ['check'] });

		const result = await run();

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe(RunStatus.Failed);
		expect(mockInvokeAgentWithContract).not.toHaveBeenCalled();
	});

	test('parks rather than fails when the harness hit its rate limit, so the work is resumable', async () => {
		const { run } = setupDirectRun();

		mockInvokeAgentWithContract.mockResolvedValue({ ok: false, failure: 'harness rate limited or overloaded', rateLimited: true });

		expect((await run()).manifest.status).toBe(RunStatus.PausedRateLimit);
	});

	test('fails on a harness that refused for any other reason', async () => {
		const { run } = setupDirectRun();

		mockInvokeAgentWithContract.mockResolvedValue({ ok: false, failure: 'agent invocation failed: timed out', rateLimited: false });

		expect((await run()).manifest.status).toBe(RunStatus.Failed);
	});

	test('escalates an ambiguous ticket carrying the question, which is exactly what the queue’s relay reads', async () => {
		const { run } = setupDirectRun();

		mockInvokeAgentWithContract.mockResolvedValue({
			ok: true,
			report: reportOf({ status: WorkReportStatus.TerminatedAmbiguity, failures: ['Which one?'] }),
		});

		const result = await run();

		expect(result.manifest.status).toBe(RunStatus.Escalated);
		expect(result.error).toBe('Which one?');
	});

	test('fails a report that stopped for any other reason, rather than sending a question that is not one', async () => {
		const { run } = setupDirectRun();

		mockInvokeAgentWithContract.mockResolvedValue({
			ok: true,
			report: reportOf({ status: WorkReportStatus.TerminatedStaleReferences, failures: ['src/gone.ts does not exist'] }),
		});

		const result = await run();

		expect(result.manifest.status).toBe(RunStatus.Failed);
		expect(result.error).toBe('src/gone.ts does not exist');
	});

	test('falls back to the report’s summary when a stopped worker listed no failure, so the run never stops with an empty reason', async () => {
		const { run } = setupDirectRun();

		mockInvokeAgentWithContract.mockResolvedValue({
			ok: true,
			report: reportOf({ status: WorkReportStatus.TerminatedScope, failures: [], summary: 'the ticket asks for two features' }),
		});

		const result = await run();

		expect(result.manifest.status).toBe(RunStatus.Failed);
		expect(result.error).toBe('the ticket asks for two features');
	});

	test('re-invokes the worker with the gate output when verify comes back red, and passes once it is green', async () => {
		const { run } = setupDirectRun();

		mockRunGates
			.mockResolvedValueOnce({ error: undefined, failedFamilies: [] })
			.mockResolvedValueOnce({ error: 'tsc: 3 errors', failedFamilies: ['check'] })
			.mockResolvedValue({ error: undefined, failedFamilies: [] });

		const result = await run();

		expect(result.ok).toBe(true);
		expect(mockInvokeAgentWithContract).toHaveBeenCalledTimes(2);
		expect(mockInvokeAgentWithContract.mock.calls[1]?.[0].invocation.prompt).toContain('tsc: 3 errors');
	});

	test('gives up after the fix retries are spent, ending failed with the gate output as the reason', async () => {
		const { run } = setupDirectRun();

		mockRunGates.mockResolvedValueOnce({ error: undefined, failedFamilies: [] }).mockResolvedValue({ error: 'tsc: 3 errors', failedFamilies: ['check'] });

		const result = await run();

		expect(result.manifest.status).toBe(RunStatus.Failed);
		expect(result.error).toBe('tsc: 3 errors');
		expect(mockInvokeAgentWithContract).toHaveBeenCalledTimes(3);
	});

	test('relays what the verify gates report back to the caller, so the terminal shows the gate that is running', async () => {
		const { run } = setupDirectRun();
		const progress: string[] = [];

		mockRunGates.mockImplementation(({ step, onProgress }) => {
			onProgress?.(`${step} is running`);

			return Promise.resolve({ error: undefined, failedFamilies: [] });
		});

		await run({ onProgress: (message) => progress.push(message) });

		expect(progress).toContain('verify is running');
	});

	test('folds a relayed answer into the worker’s first invocation, telling it to continue its own earlier attempt', async () => {
		const { run } = setupDirectRun();

		await run({ answeredQuestion: { question: 'Which one?', answer: 'the second one' } });

		expect(mockInvokeAgentWithContract.mock.calls[0]?.[0].invocation.prompt).toContain('the second one');
	});
});
