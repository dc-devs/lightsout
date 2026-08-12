import { describe, expect, test } from '@jest/globals';
import { BatchOutcome, type CoverageBatchReport, type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '@/contracts';
import { seedCoverageResumeState } from '@/coverage/seedCoverageResumeState';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', testCoverage: 'true' } };

const batchStep = ({
	id,
	outcome,
	files,
	status = RunStatus.Passed,
	rationale = [`${id} says so`],
}: {
	id: string;
	outcome: BatchOutcome;
	files: CoverageBatchReport['files'];
	status?: RunStatus;
	rationale?: string[];
}): StepRecord => ({ id, status, attempts: 1, report: { outcome, files, rationale } });

/** One tracked file that did not move. */
const flat = ({ path }: { path: string }) => ({ path, beforePct: 10, afterPct: 10 });

/** One tracked file that improved. */
const risen = ({ path }: { path: string }) => ({ path, beforePct: 10, afterPct: 60 });

const manifestWith = ({ steps }: { steps: StepRecord[] }): RunManifest => ({
	runId: 'run-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: 'worklist.json',
	pipeline: 'coverage',
	harness: 'stub',
	config,
	status: RunStatus.PausedRateLimit,
	currentStep: null,
	steps,
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
});

describe('seedCoverageResumeState', () => {
	test('a run with nothing recorded resumes with a clean slate', () => {
		const state = seedCoverageResumeState({ manifest: manifestWith({ steps: [] }) });

		expect(state).toStrictEqual({ setAside: [], declineStreak: 0, fileStrikes: new Map(), batchCount: 0 });
	});

	test('a declined batch sets its files aside with the rationale the human review reads', () => {
		const steps = [batchStep({ id: 'batch-01:root', outcome: BatchOutcome.Declined, files: [flat({ path: 'src/a.ts' }), flat({ path: 'src/b.ts' })] })];

		const state = seedCoverageResumeState({ manifest: manifestWith({ steps }) });

		expect(state.setAside).toStrictEqual([{ batchId: 'batch-01:root', files: ['src/a.ts', 'src/b.ts'], rationale: ['batch-01:root says so'] }]);
		expect(state.declineStreak).toBe(1);
	});

	test('a resolved batch resets the streak, so only CONSECUTIVE declines count as systemic', () => {
		const steps = [
			batchStep({ id: 'batch-01:root', outcome: BatchOutcome.Declined, files: [flat({ path: 'src/a.ts' })] }),
			batchStep({ id: 'batch-02:root', outcome: BatchOutcome.Resolved, files: [risen({ path: 'src/b.ts' })] }),
			batchStep({ id: 'batch-03:root', outcome: BatchOutcome.Declined, files: [flat({ path: 'src/c.ts' })] }),
		];

		const state = seedCoverageResumeState({ manifest: manifestWith({ steps }) });

		expect(state.declineStreak).toBe(1);
		// every decline is still carried forward — the human owes each one a ruling
		expect(state.setAside.map((entry) => entry.batchId)).toStrictEqual(['batch-01:root', 'batch-03:root']);
	});

	test('trailing declines accumulate across a park, or three split by a rate limit would never trip', () => {
		const steps = ['batch-01:root', 'batch-02:root'].map((id) => batchStep({ id, outcome: BatchOutcome.Declined, files: [flat({ path: 'src/a.ts' })] }));

		expect(seedCoverageResumeState({ manifest: manifestWith({ steps }) }).declineStreak).toBe(2);
	});

	test('batch numbering continues past every persisted batch, including ones that never passed', () => {
		const steps = [
			batchStep({ id: 'batch-01:root', outcome: BatchOutcome.Resolved, files: [risen({ path: 'src/a.ts' })] }),
			batchStep({ id: 'batch-02:root', outcome: BatchOutcome.Resolved, files: [risen({ path: 'src/b.ts' })], status: RunStatus.Failed }),
			{ id: 'pre-flight', status: RunStatus.Passed, attempts: 1 },
		];

		const state = seedCoverageResumeState({ manifest: manifestWith({ steps }) });

		// a re-run batch takes the next number, leaving the failed record as evidence
		expect(state.batchCount).toBe(2);
		// the failed batch contributed no state of its own
		expect(state.fileStrikes.get('src/b.ts')).toBe(undefined);
	});

	test('a batch whose report is unreadable is tolerated rather than counted as a decline', () => {
		const steps = [
			batchStep({ id: 'batch-01:root', outcome: BatchOutcome.Declined, files: [flat({ path: 'src/a.ts' })] }),
			{ id: 'batch-02:root', status: RunStatus.Passed, attempts: 1, report: { nonsense: true } },
		];

		const state = seedCoverageResumeState({ manifest: manifestWith({ steps }) });

		expect(state.declineStreak).toBe(1);
		expect(state.batchCount).toBe(2);
	});

	test('a file carried through three improving batches without improving is set aside on its own', () => {
		const steps = ['batch-01:root', 'batch-02:root', 'batch-03:root'].map((id) =>
			batchStep({ id, outcome: BatchOutcome.Resolved, files: [risen({ path: 'src/moves.ts' }), flat({ path: 'src/stuck.ts' })] }),
		);

		const state = seedCoverageResumeState({ manifest: manifestWith({ steps }) });

		// the free-rider guard: an improving batch would shelter it forever
		expect(state.setAside).toStrictEqual([
			{ batchId: 'batch-03:root', files: ['src/stuck.ts'], rationale: ['no improvement across 3 batches — likely needs source changes'] },
		]);
		expect(state.fileStrikes.get('src/stuck.ts')).toBe(3);
		// the file that keeps moving never strikes
		expect(state.fileStrikes.get('src/moves.ts')).toBe(0);
	});

	test('an improvement wipes a file’s earlier strikes, so only an unbroken run of misses sets it aside', () => {
		const steps = [
			batchStep({ id: 'batch-01:root', outcome: BatchOutcome.Resolved, files: [risen({ path: 'src/other.ts' }), flat({ path: 'src/late.ts' })] }),
			batchStep({ id: 'batch-02:root', outcome: BatchOutcome.Resolved, files: [risen({ path: 'src/late.ts' })] }),
			batchStep({ id: 'batch-03:root', outcome: BatchOutcome.Resolved, files: [risen({ path: 'src/other.ts' }), flat({ path: 'src/late.ts' })] }),
		];

		const state = seedCoverageResumeState({ manifest: manifestWith({ steps }) });

		expect(state.fileStrikes.get('src/late.ts')).toBe(1);
		expect(state.setAside).toStrictEqual([]);
	});
});
