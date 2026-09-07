import { describe, expect, test } from '@jest/globals';
import { AcceptanceTestRecord } from '#src/contracts/index.ts';

const setupRow = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const row: Record<string, unknown> = {
		criterion: 'A refused review goes red without running a gate',
		testFile: 'packages/engine/src/pipeline/steps/verifyStep.testReview.unit.test.ts',
		testName: 'verifyStep: a refused review goes red under the review family and no gate command runs',
		gate: 'test',
		...extra,
	};

	if (omit) {
		delete row[omit];
	}

	return { row };
};

describe('AcceptanceTestRecord', () => {
	test('AcceptanceTestRecord: a row carries criterion, file, test name and gate, and rejects an empty field', () => {
		const { row } = setupRow();

		const parsed = AcceptanceTestRecord.parse(row);

		expect(parsed).toStrictEqual({
			criterion: 'A refused review goes red without running a gate',
			testFile: 'packages/engine/src/pipeline/steps/verifyStep.testReview.unit.test.ts',
			testName: 'verifyStep: a refused review goes red under the review family and no gate command runs',
			gate: 'test',
		});

		for (const field of ['criterion', 'testFile', 'testName', 'gate']) {
			const { row: missing } = setupRow({ omit: field });
			const { row: blank } = setupRow({ extra: { [field]: '' } });

			// a row the engine cannot prove is refused whole — an empty test name or
			// gate would match nothing at the checkpoint rather than fail it
			expect(AcceptanceTestRecord.safeParse(missing).success).toBe(false);
			expect(AcceptanceTestRecord.safeParse(blank).success).toBe(false);
		}
	});
});
