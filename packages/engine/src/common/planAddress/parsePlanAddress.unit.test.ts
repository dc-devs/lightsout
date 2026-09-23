import { describe, expect, test } from '@jest/globals';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';

const setupNonAddresses = () => {
	const legacyName = 'lo-140-multi';
	const threeSegments = 'a/b/001-x';
	const secondSegmentNotAPlanId = 'lo-140/notes';
	const emptyFirstSegment = '/001-x';
	const parentFirstSegment = '../001-x';
	const trailingSlash = 'lo-140/001-x/';

	return {
		legacyName,
		threeSegments,
		secondSegmentNotAPlanId,
		emptyFirstSegment,
		parentFirstSegment,
		trailingSlash,
	};
};

describe('parsePlanAddress', () => {
	test('reads the ticket branch and plan id out of a two-segment address', () => {
		const address = parsePlanAddress({ name: 'lo-140-multi/002-queue-order' });

		expect(address).toStrictEqual({
			workOrderName: 'lo-140-multi',
			planId: '002-queue-order',
		});
	});

	test('answers undefined for a legacy name, any other segment count, or a second segment that is not a plan id', () => {
		const { legacyName, threeSegments, secondSegmentNotAPlanId, emptyFirstSegment, parentFirstSegment, trailingSlash } = setupNonAddresses();

		const parsedLegacyName = parsePlanAddress({ name: legacyName });
		const parsedThreeSegments = parsePlanAddress({ name: threeSegments });
		const parsedSecondSegmentNotAPlanId = parsePlanAddress({ name: secondSegmentNotAPlanId });
		const parsedEmptyFirstSegment = parsePlanAddress({ name: emptyFirstSegment });
		const parsedParentFirstSegment = parsePlanAddress({ name: parentFirstSegment });
		const parsedTrailingSlash = parsePlanAddress({ name: trailingSlash });

		expect(parsedLegacyName).toBeUndefined();
		expect(parsedThreeSegments).toBeUndefined();
		expect(parsedSecondSegmentNotAPlanId).toBeUndefined();
		expect(parsedEmptyFirstSegment).toBeUndefined();
		expect(parsedParentFirstSegment).toBeUndefined();
		expect(parsedTrailingSlash).toBeUndefined();
	});
});
