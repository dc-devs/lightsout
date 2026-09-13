import { describe, expect, test } from '@jest/globals';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';

describe('formatPlanAddress', () => {
	test('joins the ticket branch and plan id with one slash and parses back to the same pair', () => {
		const address = formatPlanAddress({ ticketBranch: 'lo-140-multi', planId: '001-record' });

		const parsed = parsePlanAddress({ name: address });

		expect(address).toBe('lo-140-multi/001-record');
		expect(parsed).toEqual({ ticketBranch: 'lo-140-multi', planId: '001-record' });
	});
});
