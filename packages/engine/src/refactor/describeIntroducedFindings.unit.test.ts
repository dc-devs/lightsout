import { describe, expect, test } from '@jest/globals';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { describeIntroducedFindings } from '#src/refactor/index.ts';

/** One introduced finding, sited in the file the run created. */
const setupIntroduced = (): { findings: StandardsFinding[] } => ({
	findings: [
		{
			rule: 'explicit-return-type',
			severity: StandardsSeverity.Blocking,
			siteKey: 'explicit-return-type:src/refactor/createBatchTools.ts',
			files: [{ path: 'src/refactor/createBatchTools.ts' }],
			detail: "exported 'createBatchTools' declares no return type",
			guidance: 'Declare the return type.',
		},
	],
});

describe('describeIntroducedFindings', () => {
	test('names what appeared and where, so the reader can find the edit that did it', () => {
		const { findings } = setupIntroduced();

		const message = describeIntroducedFindings({ findings });

		expect(message).toContain('refactor introduced 1 blocking finding(s) it never set out to fix:');
		expect(message).toContain('- explicit-return-type:src/refactor/createBatchTools.ts');
		expect(message).toContain("exported 'createBatchTools' declares no return type");
		expect(message).toContain('at src/refactor/createBatchTools.ts');
	});

	test('says where the work is, because the engine never commits', () => {
		const { findings } = setupIntroduced();

		const message = describeIntroducedFindings({ findings });

		expect(message).toContain('The run’s changes are in the working tree');
	});
});
