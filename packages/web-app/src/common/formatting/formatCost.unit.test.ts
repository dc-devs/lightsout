import { describe, expect, test } from '@jest/globals';
import { formatCost } from '#src/common/formatting/formatCost.ts';

describe('formatCost', () => {
	test('prints two decimals for a whole-dollar amount', () => {
		const label = formatCost({ usd: 2 });

		expect(label).toBe('$2.00');
	});

	test('rounds to the cent the ledger reports', () => {
		const label = formatCost({ usd: 1.2349 });

		expect(label).toBe('$1.23');
	});

	test('prints a zero cost rather than an empty string', () => {
		const label = formatCost({ usd: 0 });

		expect(label).toBe('$0.00');
	});
});
