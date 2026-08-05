import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BatchReport } from '@/contracts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const report = {
		outcome: 'declined',
		remainingClusters: ['clone:src/scan/scanClones.ts', 'size:src/pipeline/runGates.ts'],
		rationale: ['the two blocks read alike but diverge on the detector contract'],
		...overrides,
	};

	return { report };
};

describe('BatchReport', () => {
	test('a resolved report parses to exactly the three fields a batch persists', () => {
		const { report } = setupReport({ outcome: 'resolved', remainingClusters: [], rationale: ['the agent noted the shared helper it extracted'] });

		const parsed = BatchReport.parse(report);

		assert.deepEqual(
			parsed,
			{ outcome: 'resolved', remainingClusters: [], rationale: ['the agent noted the shared helper it extracted'] },
			'rationale is tied to neither outcome — runBatch emits it on the resolved paths too, so the schema must not refuse a resolved report that carries one',
		);
	});

	test('a declined report keeps the clusters that persist and the account of why', () => {
		const { report } = setupReport();

		const parsed = BatchReport.parse(report);

		assert.deepEqual(parsed, {
			outcome: 'declined',
			remainingClusters: ['clone:src/scan/scanClones.ts', 'size:src/pipeline/runGates.ts'],
			rationale: ['the two blocks read alike but diverge on the detector contract'],
		});
	});

	test('outcome accepts each of the two recorded endings', () => {
		for (const outcome of ['resolved', 'declined']) {
			const { report } = setupReport({ outcome });

			const parsed = BatchReport.parse(report);

			assert.equal(parsed.outcome, outcome, `${outcome} is one of the two ways a batch ends — the pipeline branches on this value to count the decline streak`);
		}
	});

	test('rejects an outcome outside the two recorded endings', () => {
		const { report } = setupReport({ outcome: 'failed' });

		const result = BatchReport.safeParse(report);

		assert.equal(result.success, false, 'a failed or escalated batch is stopped before a report is parsed; an invented ending would read as neither resolved nor declined and silently reset the decline streak');
	});

	test('rejects the capitalized outcome key — the contract carries the lowercase values', () => {
		const { report } = setupReport({ outcome: 'Declined' });

		const result = BatchReport.safeParse(report);

		assert.equal(result.success, false, 'the enum is built from the BatchOutcome values, not its capitalized keys');
	});

	test('every field is required — no default invents an ending, a cluster list, or a rationale', () => {
		for (const field of ['outcome', 'remainingClusters', 'rationale']) {
			const { report } = setupReport({ [field]: undefined });

			const result = BatchReport.safeParse(report);

			assert.equal(result.success, false, `${field} is required — the pipeline reads remainingClusters.length and hands rationale straight to the human, so an absent field would surface as an empty decline reason rather than a bad report`);
		}
	});

	test('rejects a bare string where a list belongs', () => {
		for (const overrides of [{ remainingClusters: 'clone:src/scan/scanClones.ts' }, { rationale: 'the duplication is intentional' }]) {
			const { report } = setupReport(overrides);

			const result = BatchReport.safeParse(report);

			assert.equal(result.success, false, 'a single value in place of the list is a malformed report, not a one-entry list');
		}
	});

	test('rejects a non-string entry inside either list', () => {
		for (const overrides of [{ remainingClusters: [{ id: 'clone:src/scan/scanClones.ts' }] }, { rationale: [42] }]) {
			const { report } = setupReport(overrides);

			const result = BatchReport.safeParse(report);

			assert.equal(result.success, false, 'both lists are printed to a human verbatim — a structured entry would render as [object Object]');
		}
	});

	test('empty lists parse — a batch that resolved everything and offered no account is still a report', () => {
		const { report } = setupReport({ outcome: 'resolved', remainingClusters: [], rationale: [] });

		const parsed = BatchReport.parse(report);

		assert.deepEqual(parsed, { outcome: 'resolved', remainingClusters: [], rationale: [] }, 'the arrays carry no minimum — an agent that reported complete with nothing to say writes two empty lists');
	});

	test('keys the schema does not declare are stripped when a persisted step report is read back', () => {
		const { report } = setupReport();

		const parsed = BatchReport.parse({ ...report, changedFiles: ['src/scan/scanClones.ts'], batchId: 'batch-01:clones:src' });

		assert.deepEqual(
			parsed,
			{
				outcome: 'declined',
				remainingClusters: ['clone:src/scan/scanClones.ts', 'size:src/pipeline/runGates.ts'],
				rationale: ['the two blocks read alike but diverge on the detector contract'],
			},
			'the step record keeps changedFiles beside the report; parsing the payload holds only the fields the contract declares',
		);
	});

	test('safeParse refuses a step report that is not an object at all', () => {
		for (const value of [undefined, null, 'declined', ['declined']]) {
			const result = BatchReport.safeParse(value);

			assert.equal(result.success, false, 'resume reads every passed step record through safeParse, including steps that carry no batch report — a non-object must fail rather than throw or read as declined');
		}
	});
});
