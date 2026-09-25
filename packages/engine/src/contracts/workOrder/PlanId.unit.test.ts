import { describe, expect, test } from '@jest/globals';
import { PlanId } from '#src/contracts/workOrder/PlanId.ts';

const fortyCharacterSlug = 'search-basics-queue-order-ship-request-a';

describe('PlanId', () => {
	test('accepts a three-digit id with a hyphenated slug up to forty characters and refuses a longer slug', () => {
		const plain = PlanId.safeParse('001-search-basics');
		const atTheCap = PlanId.safeParse(`001-${fortyCharacterSlug}`);
		const overTheCap = PlanId.safeParse(`001-${fortyCharacterSlug}b`);

		expect(fortyCharacterSlug).toHaveLength(40);
		expect(plain.success).toBe(true);
		expect(plain.data).toBe('001-search-basics');
		expect(atTheCap.success).toBe(true);
		expect(atTheCap.data).toBe('001-search-basics-queue-order-ship-request-a');
		expect(overTheCap.success).toBe(false);
	});

	test('refuses an id whose number is not three digits from 001 to 999', () => {
		const numbers = ['1-search', '0001-search', '000-search', 'abc-search', '001-search', '999-search'];

		const results = numbers.map((id) => ({ id, accepted: PlanId.safeParse(id).success }));

		expect(results).toStrictEqual([
			{ id: '1-search', accepted: false },
			{ id: '0001-search', accepted: false },
			{ id: '000-search', accepted: false },
			{ id: 'abc-search', accepted: false },
			{ id: '001-search', accepted: true },
			{ id: '999-search', accepted: true },
		]);
	});

	test('refuses a slug that is not lowercase letter-and-digit words joined by single hyphens', () => {
		const slugs = ['001-Search', '001-search_basics', '001--search', '001-search-', '001-search--basics', '001-', '001search'];

		const results = slugs.map((id) => ({ id, accepted: PlanId.safeParse(id).success }));

		expect(results).toStrictEqual([
			{ id: '001-Search', accepted: false },
			{ id: '001-search_basics', accepted: false },
			{ id: '001--search', accepted: false },
			{ id: '001-search-', accepted: false },
			{ id: '001-search--basics', accepted: false },
			{ id: '001-', accepted: false },
			{ id: '001search', accepted: false },
		]);
	});
});
