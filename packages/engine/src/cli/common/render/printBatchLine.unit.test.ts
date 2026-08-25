import { describe, expect, test } from '@jest/globals';
import { printBatchLine } from '#src/cli/common/render/printBatchLine.ts';
import { RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

const stepOf = (overrides: Partial<StepRecord> = {}): StepRecord => ({
	id: 'batch-01:duplicate-code-block:src',
	status: RunStatus.Passed,
	attempts: 1,
	...overrides,
});

describe('printBatchLine', () => {
	test('a passed batch gets the check icon, its label, and its file count', () => {
		const { logged } = captureCommandOutput();

		printBatchLine({ step: stepOf({ changedFiles: ['a.ts', 'b.ts'] }), optedOut: false, label: 'resolved' });

		expect(logged[0]).toContain('✓ batch-01:duplicate-code-block:src');
		expect(logged[0]).toContain('resolved');
		expect(logged[0]).toContain('2 file(s)');
	});

	test('an opt-out is not a failure — its own icon, and no file suffix when nothing changed', () => {
		const { logged } = captureCommandOutput();

		printBatchLine({ step: stepOf(), optedOut: true, label: 'declined' });

		expect(logged[0]).toContain('⤫ batch-01:duplicate-code-block:src');
		expect(logged[0]).not.toContain('file(s)');
	});

	test('a failed step earns the red cross whatever the opt-out flag says', () => {
		const { logged } = captureCommandOutput();

		printBatchLine({ step: stepOf({ status: RunStatus.Failed }), optedOut: true, label: 'failed' });

		expect(logged[0]).toContain('✗ batch-01:duplicate-code-block:src');
	});
});
