import { describe, expect, test } from '@jest/globals';
import type { LedgerRow } from '#src/contracts/index.ts';
import { seedAcceptanceTests } from '#src/pipeline/steps/ledger/seedAcceptanceTests.ts';

const setupRows = (): { rows: LedgerRow[] } => {
	const rows: LedgerRow[] = [
		{
			criterion: 'A refused review goes red without running a gate',
			testFile: 'packages/engine/src/pipeline/steps/verifyStep.testReview.unit.test.ts',
			testName: 'verifyStep: a refused review goes red under the review family and no gate command runs',
			gate: 'test',
			line: 12,
		},
		{
			criterion: 'The approved copies are gone once every step has passed',
			testFile: 'packages/engine/src/pipeline/approvedTests/removeApprovedTests.unit.test.ts',
			testName: 'removeApprovedTests: the run approved directory is deleted and the rest of the run folder stands',
			gate: 'test-coverage',
			line: 30,
		},
	];

	return { rows };
};

describe('seedAcceptanceTests', () => {
	test('seedAcceptanceTests: one record per ledger row, carrying criterion, file, test name and gate', () => {
		const { rows } = setupRows();

		const acceptanceTests = seedAcceptanceTests({ rows });

		// one record per row, in the ledger's own order, carrying the four fields
		// the checkpoint proves a row by — and none of the plan-file bookkeeping,
		// so the mapping a disposition later rewrites holds nothing stale
		expect(acceptanceTests).toStrictEqual([
			{
				criterion: 'A refused review goes red without running a gate',
				testFile: 'packages/engine/src/pipeline/steps/verifyStep.testReview.unit.test.ts',
				testName: 'verifyStep: a refused review goes red under the review family and no gate command runs',
				gate: 'test',
			},
			{
				criterion: 'The approved copies are gone once every step has passed',
				testFile: 'packages/engine/src/pipeline/approvedTests/removeApprovedTests.unit.test.ts',
				testName: 'removeApprovedTests: the run approved directory is deleted and the rest of the run folder stands',
				gate: 'test-coverage',
			},
		]);
	});
});
