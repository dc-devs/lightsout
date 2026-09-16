import { expect, test } from '@jest/globals';
import { PlanningContract } from '#src/contracts/index.ts';

const setup = ({ mapped }: { mapped: boolean }) => {
	const claim = {
		id: 'c1',
		kind: mapped ? 'acceptance' : 'requirement',
		text: 'Retry completed uploads once',
		explanation: '',
		contentRevision: 1,
		origin: { artifact: 'notes.md', locator: 'Retry', sha256: 'a'.repeat(64), text: 'Retry completed uploads once' },
		owner: 'planner',
		state: 'settled',
		dependencies: [],
		scope: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
		...(mapped
			? {
					acceptance: {
						kind: 'test',
						criterion: 'Retry only incomplete uploads',
						testFile: 'src/retry.unit.test.ts',
						testName: 'preserves completion',
						gate: 'test',
					},
				}
			: {}),
	};
	return {
		format: 'lightsout-planning-v1',
		generation: 'b'.repeat(64),
		claims: [claim],
		interfaces: [],
		invariants: [],
		standards: [],
		acceptance: [claim],
		allowedRoots: ['src'],
		privateFreedom: 'Private helpers',
		predecessorReceiptIds: [],
		artifacts: [],
	};
};

test.each([true, false])('requires concrete acceptance mappings in receiving contracts', (mapped) => {
	const input = setup({ mapped });

	const result = PlanningContract.safeParse(input);

	expect(result.success).toBe(mapped);
});
