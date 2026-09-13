import { describe, expect, test } from '@jest/globals';
import { TicketSyncState } from '#src/contracts/index.ts';

const recordDigest = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const markerDigest = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';

const setupSyncState = ({ planId = '001-search', marker = markerDigest }: { planId?: string; marker?: string } = {}) => {
	const syncState = {
		schemaVersion: 1,
		recordSha256: recordDigest,
		planMarkers: { [planId]: marker },
	};

	return { syncState };
};

describe('TicketSyncState', () => {
	test('TicketSyncState: accepts SHA-256 hashes keyed by plan id and rejects a malformed plan id or hash', () => {
		const { syncState } = setupSyncState();
		const malformedPlanId = setupSyncState({ planId: '1-search' });
		const uppercaseMarker = setupSyncState({ marker: markerDigest.toUpperCase() });
		const shortMarker = setupSyncState({ marker: markerDigest.slice(1) });
		const notHexMarker = setupSyncState({ marker: `${markerDigest.slice(1)}g` });

		const accepted = TicketSyncState.safeParse(syncState);
		const badPlanId = TicketSyncState.safeParse(malformedPlanId.syncState);
		const uppercase = TicketSyncState.safeParse(uppercaseMarker.syncState);
		const tooShort = TicketSyncState.safeParse(shortMarker.syncState);
		const notHex = TicketSyncState.safeParse(notHexMarker.syncState);
		const badRecordHash = TicketSyncState.safeParse({
			...syncState,
			recordSha256: recordDigest.toUpperCase(),
		});
		const noRecordHash = TicketSyncState.safeParse({
			schemaVersion: 1,
			planMarkers: {},
		});

		expect(accepted.success).toBe(true);
		expect(accepted.data).toStrictEqual({
			schemaVersion: 1,
			recordSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
			planMarkers: {
				'001-search': '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
			},
		});
		expect(noRecordHash.success).toBe(true);
		expect(noRecordHash.data).not.toHaveProperty('recordSha256');
		expect(badPlanId.success).toBe(false);
		expect(uppercase.success).toBe(false);
		expect(tooShort.success).toBe(false);
		expect(notHex.success).toBe(false);
		expect(badRecordHash.success).toBe(false);
	});
});
