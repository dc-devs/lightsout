import { describe, expect, test } from '@jest/globals';
import { BatchOutcome, type LightsoutConfig, type RefactorBatch, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { seedResumeState } from '#src/refactor/index.ts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const batch = (id: string): RefactorBatch => ({ id, rule: 'duplicate-code-block', folder: 'src', blocking: [], advisories: [] });

const step = ({ id, outcome, status = RunStatus.Passed }: { id: string; outcome?: BatchOutcome; status?: RunStatus }): StepRecord => ({
	id,
	status,
	attempts: 1,
	report:
		outcome === undefined ? undefined : { outcome, remainingSiteKeys: outcome === BatchOutcome.Declined ? [`${id}-site`] : [], rationale: [`${id} says so`] },
});

const manifestWith = ({ steps }: { steps: StepRecord[] }): RunManifest => ({
	runId: 'run-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: 'worklist.json',
	pipeline: 'refactor',
	harness: 'stub',
	config,
	status: RunStatus.PausedRateLimit,
	currentStep: null,
	steps,
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	ledgerTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

describe('seedResumeState', () => {
	test('a run with nothing recorded resumes with a clean slate', () => {
		const state = seedResumeState({ manifest: manifestWith({ steps: [] }), batches: [batch('batch-01')] });

		expect(state).toStrictEqual({ declined: [], declineStreak: 0 });
	});

	test('carries earlier declines forward, because the human still has to review them', () => {
		const steps = [step({ id: 'batch-01', outcome: BatchOutcome.Declined }), step({ id: 'batch-02', outcome: BatchOutcome.Declined })];

		const state = seedResumeState({ manifest: manifestWith({ steps }), batches: [batch('batch-01'), batch('batch-02')] });

		expect(state.declined.map(({ batchId }) => batchId)).toStrictEqual(['batch-01', 'batch-02']);
		// the streak survives the park, or three declines split across a rate
		// limit would never trip the systemic stop
		expect(state.declineStreak).toBe(2);
	});

	test('a resolved batch resets the streak, so only CONSECUTIVE declines count as systemic', () => {
		const steps = [
			step({ id: 'batch-01', outcome: BatchOutcome.Declined }),
			step({ id: 'batch-02', outcome: BatchOutcome.Resolved }),
			step({ id: 'batch-03', outcome: BatchOutcome.Declined }),
		];

		const state = seedResumeState({ manifest: manifestWith({ steps }), batches: [batch('batch-01'), batch('batch-02'), batch('batch-03')] });

		expect(state.declined.map(({ batchId }) => batchId)).toStrictEqual(['batch-01', 'batch-03']);
		expect(state.declineStreak).toBe(1);
	});

	test('stops at the first batch that did not pass — nothing beyond it has state to rebuild', () => {
		const steps = [
			step({ id: 'batch-01', outcome: BatchOutcome.Declined }),
			step({ id: 'batch-02', status: RunStatus.Running }),
			step({ id: 'batch-03', outcome: BatchOutcome.Declined }),
		];

		const state = seedResumeState({ manifest: manifestWith({ steps }), batches: [batch('batch-01'), batch('batch-02'), batch('batch-03')] });

		expect(state.declined.map(({ batchId }) => batchId)).toStrictEqual(['batch-01']);
	});

	test('a passed batch whose report is unreadable resets the streak rather than being counted as a decline', () => {
		const steps = [
			step({ id: 'batch-01', outcome: BatchOutcome.Declined }),
			{ id: 'batch-02', status: RunStatus.Passed, attempts: 1, report: { nonsense: true } },
		];

		const state = seedResumeState({ manifest: manifestWith({ steps }), batches: [batch('batch-01'), batch('batch-02')] });

		// a report that does not parse is not evidence of a decline
		expect(state.declineStreak).toBe(0);
	});
});
