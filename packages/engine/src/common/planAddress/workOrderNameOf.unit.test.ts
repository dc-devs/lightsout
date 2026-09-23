import { describe, expect, test } from '@jest/globals';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';

describe('workOrderNameOf', () => {
	test('answers the ticket-branch segment of an address and the whole name for a legacy name', () => {
		const fromAddress = workOrderNameOf({ name: 'lo-140-multi/001-record' });
		const fromLegacyFolder = workOrderNameOf({ name: 'lo-140-multi' });
		const fromThreeSegments = workOrderNameOf({ name: 'a/b/001-x' });

		expect({ fromAddress, fromLegacyFolder, fromThreeSegments }).toStrictEqual({
			fromAddress: 'lo-140-multi',
			fromLegacyFolder: 'lo-140-multi',
			fromThreeSegments: 'a/b/001-x',
		});
	});
});
