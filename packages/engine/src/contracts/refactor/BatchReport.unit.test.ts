import { describe, expect, test } from '@jest/globals';
import { BatchReport } from '#src/contracts/index.ts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const report = {
		outcome: 'declined',
		remainingSiteKeys: ['clone:src/standardsCheck/checkClones.ts', 'size:src/pipeline/runGates.ts'],
		rationale: ['the two blocks read alike but diverge on the detector contract'],
		...overrides,
	};

	return { report };
};

describe('BatchReport', () => {
	test('a resolved report parses to exactly the three fields a batch persists', () => {
		const { report } = setupReport({ outcome: 'resolved', remainingSiteKeys: [], rationale: ['the agent noted the shared helper it extracted'] });

		const parsed = BatchReport.parse(report);

		// rationale is tied to neither outcome — runBatch emits it on the resolved
		// paths too, so the schema must not refuse a resolved report that carries one
		expect(parsed).toStrictEqual({ outcome: 'resolved', remainingSiteKeys: [], rationale: ['the agent noted the shared helper it extracted'] });
	});

	test('a declined report keeps the site keys that persist and the account of why', () => {
		const { report } = setupReport();

		const parsed = BatchReport.parse(report);

		expect(parsed).toStrictEqual({
			outcome: 'declined',
			remainingSiteKeys: ['clone:src/standardsCheck/checkClones.ts', 'size:src/pipeline/runGates.ts'],
			rationale: ['the two blocks read alike but diverge on the detector contract'],
		});
	});

	test('outcome accepts each of the two recorded endings', () => {
		for (const outcome of ['resolved', 'declined']) {
			const { report } = setupReport({ outcome });

			const parsed = BatchReport.parse(report);

			// ${outcome} is one of the two ways a batch ends — the pipeline branches on
			// this value to count the decline streak
			expect(parsed.outcome).toBe(outcome);
		}
	});

	test('rejects an outcome outside the two recorded endings', () => {
		const { report } = setupReport({ outcome: 'failed' });

		const result = BatchReport.safeParse(report);

		// a failed or escalated batch is stopped before a report is parsed; an
		// invented ending would read as neither resolved nor declined and silently
		// reset the decline streak
		expect(result.success).toBe(false);
	});

	test('rejects the capitalized outcome key — the contract carries the lowercase values', () => {
		const { report } = setupReport({ outcome: 'Declined' });

		const result = BatchReport.safeParse(report);

		// the enum is built from the BatchOutcome values, not its capitalized keys
		expect(result.success).toBe(false);
	});

	test('every field is required — no default invents an ending, a site-key list, or a rationale', () => {
		for (const field of ['outcome', 'remainingSiteKeys', 'rationale']) {
			const { report } = setupReport({ [field]: undefined });

			const result = BatchReport.safeParse(report);

			// ${field} is required — the pipeline reads remainingSiteKeys.length and hands
			// rationale straight to the human, so an absent field would surface as an
			// empty decline reason rather than a bad report
			expect(result.success).toBe(false);
		}
	});

	test('rejects a bare string where a list belongs', () => {
		for (const overrides of [{ remainingSiteKeys: 'clone:src/standardsCheck/checkClones.ts' }, { rationale: 'the duplication is intentional' }]) {
			const { report } = setupReport(overrides);

			const result = BatchReport.safeParse(report);

			// a single value in place of the list is a malformed report, not a one-entry
			// list
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-string entry inside either list', () => {
		for (const overrides of [{ remainingSiteKeys: [{ id: 'clone:src/standardsCheck/checkClones.ts' }] }, { rationale: [42] }]) {
			const { report } = setupReport(overrides);

			const result = BatchReport.safeParse(report);

			// both lists are printed to a human verbatim — a structured entry would render
			// as [object Object]
			expect(result.success).toBe(false);
		}
	});

	test('empty lists parse — a batch that resolved everything and offered no account is still a report', () => {
		const { report } = setupReport({ outcome: 'resolved', remainingSiteKeys: [], rationale: [] });

		const parsed = BatchReport.parse(report);

		// the arrays carry no minimum — an agent that reported complete with nothing
		// to say writes two empty lists
		expect(parsed).toStrictEqual({ outcome: 'resolved', remainingSiteKeys: [], rationale: [] });
	});

	test('keys the schema does not declare are stripped when a persisted step report is read back', () => {
		const { report } = setupReport();

		const parsed = BatchReport.parse({ ...report, changedFiles: ['src/standardsCheck/checkClones.ts'], batchId: 'batch-01:clones:src' });

		// the step record keeps changedFiles beside the report; parsing the payload
		// holds only the fields the contract declares
		expect(parsed).toStrictEqual({
			outcome: 'declined',
			remainingSiteKeys: ['clone:src/standardsCheck/checkClones.ts', 'size:src/pipeline/runGates.ts'],
			rationale: ['the two blocks read alike but diverge on the detector contract'],
		});
	});

	test('a report written under the old remainingClusters name is refused, not read as nothing remaining', () => {
		const { report } = setupReport({ remainingSiteKeys: undefined });

		const result = BatchReport.safeParse({ ...report, remainingClusters: ['clone:src/standardsCheck/checkClones.ts'] });

		// the old key is stripped as undeclared and the new one is still missing —
		// the two must combine to a refusal, because a silently accepted stale report
		// would read as a declined batch with zero sites persisting
		expect(result.success).toBe(false);
	});

	test('safeParse refuses a step report that is not an object at all', () => {
		for (const value of [undefined, null, 'declined', ['declined']]) {
			const result = BatchReport.safeParse(value);

			// resume reads every passed step record through safeParse, including steps
			// that carry no batch report — a non-object must fail rather than throw or
			// read as declined
			expect(result.success).toBe(false);
		}
	});

	test('the advisory account rides along when the agent gave one', () => {
		const { report } = setupReport({
			advisoryOutcomes: [{ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'declined', reason: 'orchestration exemption applies' }],
		});

		const parsed = BatchReport.parse(report);

		expect(parsed.advisoryOutcomes).toStrictEqual([
			{ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'declined', reason: 'orchestration exemption applies' },
		]);
	});

	test('an absent advisory account parses — recording advice is an account, never a gate', () => {
		const { report } = setupReport();

		// this is also every manifest written before the field existed
		expect(BatchReport.parse(report).advisoryOutcomes).toBe(undefined);
	});

	test('an empty advisory account parses as an empty list, distinct from the field being absent', () => {
		const { report } = setupReport({ advisoryOutcomes: [] });

		const parsed = BatchReport.parse(report);

		// a batch that was shown no advice reports an empty list; the health report
		// reads zero entries either way, but the list must survive the round trip
		expect(parsed.advisoryOutcomes).toStrictEqual([]);
	});

	test('a lone advisory entry handed over outside a list is refused', () => {
		const { report } = setupReport({ advisoryOutcomes: { rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'applied' } });

		const result = BatchReport.safeParse(report);

		// runBatch folds a map of entries into an array — a single object here is a
		// malformed report, not a one-entry account
		expect(result.success).toBe(false);
	});

	test('a malformed advisory entry refuses the whole report rather than being dropped', () => {
		const { report } = setupReport({ advisoryOutcomes: [{ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'maybe' }] });

		// the health report counts these entries — one that means nothing would be
		// counted as something
		expect(BatchReport.safeParse(report).success).toBe(false);
	});
});
