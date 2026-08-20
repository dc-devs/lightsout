import { describe, expect, test } from '@jest/globals';
import { printBatchOptOut } from '#src/cli/common/render/printBatchOptOut.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

describe('printBatchOptOut', () => {
	test('prints the heading with the batch id, every rationale line verbatim, and the hint last', () => {
		const { logged } = captureCommandOutput();

		printBatchOptOut({
			heading: 'declined',
			batchId: 'batch-03:clone:(cross)',
			lines: ['[standards] the mirrors are deliberate', '[prompt] destination outside the file set'],
			hint: 'review each site — fix by hand, or accept it as debt',
		});

		expect(logged[0]).toContain('declined batch-03:clone:(cross)');
		// the agent's words are reproduced, not summarized — an unreadable decline
		// is indistinguishable from silently skipped work
		expect(logged[1]).toContain('[standards] the mirrors are deliberate');
		expect(logged[2]).toContain('[prompt] destination outside the file set');
		expect(logged[3]).toContain('review each site');
	});
});
