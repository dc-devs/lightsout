import { describe, expect, test } from '@jest/globals';
import { ticketFolderOf } from '#src/common/planAddress/ticketFolderOf.ts';

describe('ticketFolderOf', () => {
	test('answers the ticket-branch segment of an address and the whole name for a legacy name', () => {
		const fromAddress = ticketFolderOf({ name: 'lo-140-multi/001-record' });
		const fromLegacyFolder = ticketFolderOf({ name: 'lo-140-multi' });
		const fromThreeSegments = ticketFolderOf({ name: 'a/b/001-x' });

		expect({ fromAddress, fromLegacyFolder, fromThreeSegments }).toStrictEqual({
			fromAddress: 'lo-140-multi',
			fromLegacyFolder: 'lo-140-multi',
			fromThreeSegments: 'a/b/001-x',
		});
	});
});
