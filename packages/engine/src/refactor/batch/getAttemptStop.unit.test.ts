import { describe, expect, test } from '@jest/globals';
import { BatchOutcome, type StandardsFinding, StandardsSeverity, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { getAttemptStop } from '#src/refactor/batch/index.ts';
import { BatchStopKind } from '#src/refactor/common/constants/BatchStopKind.ts';
import type { BatchStop } from '#src/refactor/common/types/BatchStop.ts';

const finding: StandardsFinding = {
	rule: 'multi-export',
	severity: StandardsSeverity.Blocking,
	siteKey: 'multi-export:src/a.ts',
	files: [{ path: 'src/a.ts' }],
	detail: '2 exports',
};

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'did the work',
	failures: [],
	...overrides,
});

/** A finish stub that records what it was asked and returns a recognizable done stop. */
const setupFinish = () => {
	const finished: { outcome: BatchOutcome; remainingSiteKeys: string[] }[] = [];
	const stop: BatchStop = {
		kind: BatchStopKind.Done,
		report: { outcome: BatchOutcome.Resolved, remainingSiteKeys: [], rationale: [], advisoryOutcomes: [] },
		changedFiles: [],
	};

	return {
		finished,
		stop,
		finish: async (params: { outcome: BatchOutcome; remainingSiteKeys: string[] }) => {
			finished.push(params);

			return stop;
		},
	};
};

const setupAttempt = ({
	attempt,
	remaining = [finding.siteKey],
	gateError,
}: {
	attempt: AgentOutcome<WorkReport>;
	/** Site keys a live re-check would still find (default: everything persists). */
	remaining?: string[];
	/** What the gates return when consulted — red output, or undefined for green. */
	gateError?: string;
}) => {
	const rationale: string[] = [];
	const progress: string[] = [];
	const { finished, stop, finish } = setupFinish();

	return {
		rationale,
		progress,
		finished,
		doneStop: stop,
		run: () =>
			getAttemptStop({
				batchId: 'batch-01:multi-export:src',
				attempt,
				workFindings: [finding],
				rationale,
				onProgress: (message: string) => progress.push(message),
				remainingSiteKeys: async () => remaining,
				gates: async () => gateError,
				finish,
			}),
	};
};

describe('getAttemptStop', () => {
	test('a rate-limited invocation parks the batch — the run resumes when the window resets', async () => {
		const { run } = setupAttempt({ attempt: { ok: false, failure: 'limit reached', rateLimited: true } });

		expect(await run()).toStrictEqual({ kind: BatchStopKind.Parked });
	});

	test('a failed invocation whose sites are gone and gates are green is salvaged as resolved work', async () => {
		const { run, rationale, progress, finished, doneStop } = setupAttempt({
			attempt: { ok: false, failure: 'laptop slept', rateLimited: false },
			remaining: [],
			gateError: undefined,
		});

		expect(await run()).toBe(doneStop);
		expect(finished).toStrictEqual([{ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }]);
		// the classification is recorded, not silent — the report and the stream both say so
		expect(rationale).toStrictEqual(['[other] salvaged: agent invocation failed (laptop slept) but the sites are resolved and gates are green']);
		expect(progress).toStrictEqual(['batch-01:multi-export:src: invocation failed but work verified on disk — salvaged as resolved']);
	});

	test('a failed invocation with sites persisting fails the batch, naming it and the failure', async () => {
		const { run } = setupAttempt({ attempt: { ok: false, failure: 'harness crashed', rateLimited: false } });

		expect(await run()).toStrictEqual({ kind: BatchStopKind.Failed, error: 'batch-01:multi-export:src: harness crashed' });
	});

	test('sites gone but gates red is no salvage — unverified work is still a failure', async () => {
		const { run, finished } = setupAttempt({
			attempt: { ok: false, failure: 'harness crashed', rateLimited: false },
			remaining: [],
			gateError: 'test: exit 1',
		});

		expect(await run()).toStrictEqual({ kind: BatchStopKind.Failed, error: 'batch-01:multi-export:src: harness crashed' });
		expect(finished).toStrictEqual([]);
	});

	test('a scope refusal is a decline carrying the live remainder, with the reasons kept as rationale', async () => {
		const { run, rationale, finished, doneStop } = setupAttempt({
			attempt: { ok: true, report: reportOf({ status: WorkReportStatus.TerminatedScope, failures: ['not my plan', 'touches another package'] }) },
		});

		expect(await run()).toBe(doneStop);
		expect(finished).toStrictEqual([{ outcome: BatchOutcome.Declined, remainingSiteKeys: [finding.siteKey] }]);
		expect(rationale).toStrictEqual(['[scope] not my plan', '[scope] touches another package']);
	});

	test.each([
		{ status: WorkReportStatus.Failed, kind: BatchStopKind.Failed },
		{ status: WorkReportStatus.TerminatedAmbiguity, kind: BatchStopKind.Escalated },
		{ status: WorkReportStatus.TerminatedStaleReferences, kind: BatchStopKind.Escalated },
	])('a report ending $status stops the batch as $kind with the agent’s reasons joined', async ({ status, kind }) => {
		const { run } = setupAttempt({ attempt: { ok: true, report: reportOf({ status, failures: ['a', 'b'] }) } });

		expect(await run()).toStrictEqual({ kind, error: `batch-01:multi-export:src: ${status} — a; b` });
	});

	test('a complete report settles nothing here — the gates decide next, so no stop comes back', async () => {
		const { run, finished } = setupAttempt({ attempt: { ok: true, report: reportOf() } });

		expect(await run()).toBeUndefined();
		expect(finished).toStrictEqual([]);
	});
});
