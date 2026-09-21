import { describe, expect, jest, test } from '@jest/globals';
import { RunState } from '#src/common/services/RunState.ts';
import { type LightsoutConfig, PipelineKind, RunStatus } from '#src/contracts/index.ts';
import { finishDirectRun } from '#src/direct/common/utils/finishDirectRun.ts';
import { createRun } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The commit step is another module's entry point with its own tests; what this
// unit owns is which ending a run gets from the answer it gives. Run state on
// disk is real, because the record a stopped run leaves is what a resume reads.
const mockCommitRunWork = jest.fn<(params: { run: RunState; subject?: string; resumed: boolean }) => Promise<string | undefined>>();

jest.mock('#src/commit/index.ts', () => ({
	commitRunWork: (params: { run: RunState; subject?: string; resumed: boolean }) => mockCommitRunWork(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/**
 * A direct run whose gates are already green — the only state this unit is ever
 * entered in — with the commit step's answer queued for this run's turn.
 *
 * The answer is queued with `mockResolvedValueOnce` rather than set outright,
 * so two arranged runs keep their own answers when both are arranged before
 * either acts: the queue is consumed in the order the acts run.
 */
const setupFinishedRun = async ({ uncommitted }: { uncommitted?: string } = {}) => {
	const cwd = setupConsumerRepo();
	const manifest = await createRun({
		cwd,
		plan: 'ticket.md',
		pipeline: PipelineKind.Direct,
		ticketRef: 'LO-70',
		driver: 'claude-code',
		config,
	});
	const run = new RunState({ cwd, config, manifest });

	await run.setStep({ record: { id: 'verify', status: RunStatus.Passed, attempts: 1 } });
	mockCommitRunWork.mockResolvedValueOnce(uncommitted);

	return { run };
};

describe('finishDirectRun', () => {
	test('stamps a committed run passed and stops an uncommitted one', async () => {
		const committed = await setupFinishedRun();
		const refused = await setupFinishedRun({ uncommitted: 'the worker changed nothing' });

		const passed = await finishDirectRun({
			run: committed.run,
			ticketRef: 'LO-70',
			ticketBody: '# Drain the backlog\n\nBuild the thing.\n',
			resumed: false,
		});
		const stopped = await finishDirectRun({
			run: refused.run,
			ticketRef: 'LO-70',
			ticketBody: '# Drain the backlog\n\nBuild the thing.\n',
			resumed: true,
		});

		expect({
			passed: { ok: passed.ok, status: passed.manifest.status, error: passed.error },
			stopped: { ok: stopped.ok, status: stopped.manifest.status, error: stopped.error },
			// The commit's failure is recorded under its own step, so the gates the
			// run already passed keep saying so.
			stoppedSteps: stopped.manifest.steps.map((step) => ({ id: step.id, status: step.status })),
			asked: mockCommitRunWork.mock.calls.map((call) => ({ subject: call[0].subject, resumed: call[0].resumed })),
		}).toStrictEqual({
			passed: { ok: true, status: RunStatus.Passed, error: undefined },
			stopped: { ok: false, status: RunStatus.Failed, error: 'the worker changed nothing' },
			stoppedSteps: [
				{ id: 'verify', status: RunStatus.Passed },
				{ id: 'commit', status: RunStatus.Failed },
			],
			asked: [
				{ subject: 'LO-70 Drain the backlog', resumed: false },
				{ subject: 'LO-70 Drain the backlog', resumed: true },
			],
		});
	});
});
