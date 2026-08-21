import { describe, expect, test } from '@jest/globals';
import { BatchOutcome, type RefactorBatch, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { SettleKind } from '#src/refactor/batch/common/constants/SettleKind.ts';
import type { BatchTools } from '#src/refactor/batch/common/types/BatchTools.ts';
import { polishBatchOutput } from '#src/refactor/batch/index.ts';
import { BatchStopKind } from '#src/refactor/common/constants/BatchStopKind.ts';

const finding = (overrides: Partial<StandardsFinding> & { siteKey: string }): StandardsFinding => ({
	rule: 'single-return',
	severity: StandardsSeverity.Advisory,
	files: [{ path: 'src/a.ts' }],
	detail: 'six exits',
	...overrides,
});

const workFindings = [finding({ rule: 'multi-export', severity: StandardsSeverity.Blocking, siteKey: 'multi-export:src/a.ts', detail: '2 exports' })];

const batch: RefactorBatch = { id: 'batch-01:multi-export:src', rule: 'multi-export', folder: 'src', blocking: workFindings, advisories: [] };

interface StubParams {
	/** What the review of the batch's output turns up. */
	introduced?: StandardsFinding[];
	/** How the gates come to rest after the polish invocation. */
	settleKind?: SettleKind;
	/** Sites the re-check finds standing again after the polish. */
	revived?: string[];
}

/** A `BatchTools` that records what the polish asked of it, so the test can read back the decisions rather than the plumbing. */
const setupTools = ({ introduced = [], settleKind = SettleKind.Green, revived = [] }: StubParams = {}) => {
	const invocations: string[] = [];
	const finished: { outcome: BatchOutcome; remainingSiteKeys: string[] }[] = [];
	const progress: string[] = [];
	const reviewed: StandardsFinding[][] = [];

	const tools = {
		invoke: async ({ label }: { label: string }) => {
			invocations.push(label);

			return { ok: true as const, report: { summary: '', changedFiles: ['src/a.ts'], advisoryOutcomes: [] } };
		},
		finish: async ({ outcome, remainingSiteKeys }: { outcome: BatchOutcome; remainingSiteKeys: string[] }) => {
			finished.push({ outcome, remainingSiteKeys });

			return { kind: BatchStopKind.Done, report: { outcome, remainingSiteKeys, rationale: [], advisoryOutcomes: [] }, changedFiles: ['src/a.ts'] };
		},
		reviewOutput: async ({ baseline }: { baseline: StandardsFinding[] }) => {
			reviewed.push(baseline);

			return introduced;
		},
		settle: async () => (settleKind === SettleKind.Green ? { kind: SettleKind.Green } : { kind: settleKind, error: 'a human must look at this' }),
		remainingSiteKeys: async () => revived,
	} as unknown as BatchTools;

	const call = () =>
		polishBatchOutput({
			tools,
			batch,
			baseline: [finding({ siteKey: 'size-function:src/a.ts', rule: 'size-function' })],
			workFindings,
			onProgress: (line) => progress.push(line),
		});

	return { call, invocations, finished, progress, reviewed };
};

describe('polishBatchOutput', () => {
	test('a clean read of the batch’s output resolves without spending another agent', async () => {
		const { call, invocations, finished } = setupTools();

		const stop = await call();

		expect(invocations).toStrictEqual([]);
		expect(finished).toStrictEqual([{ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }]);
		expect(stop.kind).toBe(BatchStopKind.Done);
	});

	test('the review is handed the pre-edit advisories, so it only reports what the edits added', async () => {
		const { call, reviewed } = setupTools();

		await call();

		expect(reviewed.map((baseline) => baseline.map((entry) => entry.siteKey))).toStrictEqual([['size-function:src/a.ts']]);
	});

	test('a new advisory buys exactly one polish pass, and the batch still resolves', async () => {
		const { call, invocations, finished, progress } = setupTools({ introduced: [finding({ siteKey: 'single-return:src/a.ts' })] });

		await call();

		expect(invocations).toStrictEqual(['polish']);
		expect(finished).toStrictEqual([{ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }]);
		expect(progress.some((line) => line.includes('raised 1 new advisory(s)'))).toBe(true);
	});

	test('a polish that revives a site the batch had cleared is a decline, not a pass', async () => {
		const { call, finished, progress } = setupTools({ introduced: [finding({ siteKey: 'single-return:src/a.ts' })], revived: ['multi-export:src/a.ts'] });

		await call();

		// the polish edits the same files the batch just cleared; trading the shape
		// problem back for the finding the batch came to burn down is not a pass
		expect(finished).toStrictEqual([{ outcome: BatchOutcome.Declined, remainingSiteKeys: ['multi-export:src/a.ts'] }]);
		expect(progress.some((line) => line.includes('brought back 1 site(s)'))).toBe(true);
	});

	test('a rate-limit wall during the polish parks the batch rather than reporting an outcome', async () => {
		const { call, finished } = setupTools({ introduced: [finding({ siteKey: 'single-return:src/a.ts' })], settleKind: SettleKind.Parked });

		const stop = await call();

		expect(stop).toStrictEqual({ kind: BatchStopKind.Parked });
		expect(finished).toStrictEqual([]);
	});

	test('a gate the polish cannot settle escalates with the reason attached', async () => {
		const { call, finished } = setupTools({ introduced: [finding({ siteKey: 'single-return:src/a.ts' })], settleKind: SettleKind.Escalated });

		const stop = await call();

		expect(stop).toStrictEqual({ kind: BatchStopKind.Escalated, error: 'a human must look at this' });
		expect(finished).toStrictEqual([]);
	});
});
