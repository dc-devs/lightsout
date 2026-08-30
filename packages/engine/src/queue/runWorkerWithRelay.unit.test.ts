import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, type RunManifest, RunStatus, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/index.ts';
import { runWorkerWithRelay } from '#src/queue/runWorkerWithRelay.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both workers spawn a harness — another module's entry point, each covered by
// its own tests. What this file owns is the loop between a worker's question and
// the answer that comes back, which is observable with both stubbed.
const mockInvokeAgentWithContract = jest.fn<(params: { invocation: { prompt: string }; timeoutMs?: number }) => Promise<AgentOutcome<WorkReport>>>();
const mockRunDirectWork = jest.fn<(params: { answeredQuestion?: { question: string; answer: string } }) => Promise<PipelineResult>>();
const mockAppendTicketNote = jest.fn<() => Promise<undefined>>();

jest.mock('#src/invoke/index.ts', () => ({
	invokeAgentWithContract: (params: { invocation: { prompt: string }; timeoutMs?: number }) => mockInvokeAgentWithContract(params),
}));
jest.mock('#src/direct/index.ts', () => ({
	runDirectWork: (params: { answeredQuestion?: { question: string; answer: string } }) => mockRunDirectWork(params),
}));
jest.mock('#src/queue/tracker/index.ts', () => ({ appendTicketNote: () => mockAppendTicketNote() }));
// -------------------------

const settings = queueSettingsFixture();

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticketOf = (route: TicketSummary['route']): TicketSummary => ({
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	route,
	unfinishedBlockers: [],
});

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'built it',
	failures: [],
	...overrides,
});

const manifestOf = (status: RunStatus): RunManifest => ({
	runId: 'run-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:01.000Z',
	plan: '.lightsout/runs/run-1/ticket.md',
	harness: 'claude-code',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/** A relay on a pair of streams, typing each queued answer as its prompt appears. */
const setupRelay = ({ answers = [] }: { answers?: string[] } = {}) => {
	const input = new PassThrough();
	const queued = [...answers];
	const output = new Writable({
		write(chunk: Buffer, _encoding, done) {
			if (chunk.toString().includes('answer: ')) {
				const next = queued.shift();

				if (next !== undefined) {
					setImmediate(() => input.write(`${next}\n`));
				} else {
					setImmediate(() => input.end());
				}
			}

			done();
		},
	});

	mockAppendTicketNote.mockResolvedValue(undefined);

	return { relay: new TerminalQuestionRelay({ settings, input, output }), coordinatorRunDir: mkdtempSync(join(tmpdir(), 'lightsout-worker-')) };
};

const runWorker = ({ relay, coordinatorRunDir, ticket }: { relay: QuestionRelay; coordinatorRunDir: string; ticket: TicketSummary }) =>
	runWorkerWithRelay({
		worktreePath: '/tmp/lo-70-drain',
		ticket,
		config,
		driver,
		driverName: 'claude-code',
		settings,
		relay,
		coordinatorRunId: 'run-q',
		coordinatorRunDir,
	});

describe('runWorkerWithRelay', () => {
	test('a direct worker that finishes needs no question, and the relay is never used', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf(RunStatus.Passed) });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.Direct) })).toStrictEqual({});

		relay.close();
	});

	test('relays a direct worker’s escalation and re-invokes it with the answer, in the same tree', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['the second one'] });

		mockRunDirectWork
			.mockResolvedValueOnce({ ok: false, manifest: manifestOf(RunStatus.Escalated), error: 'Which one?' })
			.mockResolvedValueOnce({ ok: true, manifest: manifestOf(RunStatus.Passed) });

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.Direct) });

		relay.close();

		expect(outcome).toStrictEqual({});
		expect(mockRunDirectWork).toHaveBeenLastCalledWith(expect.objectContaining({ answeredQuestion: { question: 'Which one?', answer: 'the second one' } }));
	});

	test('parks a direct run that failed for any other reason, carrying the worker’s own error', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Failed), error: 'tsc: 3 errors' });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.Direct) })).toStrictEqual({ error: 'tsc: 3 errors' });

		relay.close();
	});

	test('names the state a run ended in when it stopped without saying why', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.PausedRateLimit) });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.Direct) })).toStrictEqual({ error: 'the run ended paused-rate-limit' });

		relay.close();
	});

	test('an auto-plan worker that reports complete needs no question either', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report: reportOf() });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.AutoPlan) })).toStrictEqual({});

		relay.close();
	});

	test('gives the auto-plan session the ceiling the settings already carry, in milliseconds and unconverted', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report: reportOf() });

		await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.AutoPlan) });

		relay.close();

		expect(mockInvokeAgentWithContract.mock.calls[0]?.[0].timeoutMs).toBe(14_400_000);
	});

	test('relays an auto-plan worker’s first failure as the question it asked, and folds the answer into the next invocation', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['the second one'] });

		mockInvokeAgentWithContract
			.mockResolvedValueOnce({ ok: true, report: reportOf({ status: WorkReportStatus.TerminatedAmbiguity, failures: ['Which one?'] }) })
			.mockResolvedValueOnce({ ok: true, report: reportOf() });

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.AutoPlan) });

		relay.close();

		expect(outcome).toStrictEqual({});
		expect(mockInvokeAgentWithContract.mock.calls[1]?.[0].invocation.prompt).toContain('the second one');
	});

	test('parks an auto-plan worker whose report is neither a question nor success', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockInvokeAgentWithContract.mockResolvedValue({
			ok: true,
			report: reportOf({ status: WorkReportStatus.Failed, failures: ['the lightsout plugin skills are not available'] }),
		});

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.AutoPlan) })).toStrictEqual({
			error: 'the lightsout plugin skills are not available',
		});

		relay.close();
	});

	test('parks a harness that refused outright, so a rate limit never reads as finished work', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockInvokeAgentWithContract.mockResolvedValue({ ok: false, failure: 'harness rate limited or overloaded', rateLimited: true });

		expect(await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.AutoPlan) })).toStrictEqual({
			error: 'harness rate limited or overloaded',
		});

		relay.close();
	});

	test('stops relaying once the answers have run out, rather than asking the user forever', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['first', 'second', 'third', 'fourth'] });

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Escalated), error: 'Which one?' });

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.Direct) });

		relay.close();

		expect(outcome).toEqual({ error: expect.stringContaining('still asking after') });
		expect(mockRunDirectWork).toHaveBeenCalledTimes(3);
	});

	test('parks the ticket when there is no terminal to relay to, and marks the park unanswered — that is the one that retires a drain slot', async () => {
		const { relay, coordinatorRunDir } = setupRelay();

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Escalated), error: 'Which one?' });

		const outcome = await runWorker({ relay, coordinatorRunDir, ticket: ticketOf(QueueRoute.Direct) });

		relay.close();

		expect(outcome).toEqual({ error: expect.stringContaining('could not be relayed'), unanswered: true });
	});
});
