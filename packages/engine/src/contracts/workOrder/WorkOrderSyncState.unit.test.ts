import { describe, expect, test } from '@jest/globals';
import { WorkOrderSyncState } from '#src/contracts/workOrder/WorkOrderSyncState.ts';

const recordDigest = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const firstMarker = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
const secondMarker = '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b';

const setupSidecar = ({ extra }: { extra?: Record<string, unknown> } = {}) => {
	const sidecar = {
		schemaVersion: 1,
		recordSha256: recordDigest,
		planMarkers: {
			'001-search-basics': firstMarker,
			'002-rank-results': secondMarker,
		},
		...extra,
	};

	return { sidecar };
};

const setupSyncState = ({ planId = '001-search', marker = firstMarker }: { planId?: string; marker?: string } = {}) => {
	const syncState = {
		schemaVersion: 1,
		recordSha256: recordDigest,
		planMarkers: { [planId]: marker },
	};

	return { syncState };
};

describe('WorkOrderSyncState', () => {
	test('WorkOrderSyncState: accepts plan-id-keyed digests and refuses an undeclared key', () => {
		const { sidecar } = setupSidecar();
		const withUndeclaredKey = setupSidecar({ extra: { workOrderName: 'lo-158-one-author' } });

		const accepted = WorkOrderSyncState.safeParse(sidecar);
		const refused = WorkOrderSyncState.safeParse(withUndeclaredKey.sidecar);

		expect(accepted.success).toBe(true);
		expect(accepted.data).toStrictEqual({
			schemaVersion: 1,
			recordSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
			planMarkers: {
				'001-search-basics': '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
				'002-rank-results': '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b',
			},
		});
		expect(refused.success).toBe(false);
	});

	test('WorkOrderSyncState: accepts SHA-256 hashes keyed by plan id and rejects a malformed plan id or hash', () => {
		const { syncState } = setupSyncState();
		const malformedPlanId = setupSyncState({ planId: '1-search' });
		const uppercaseMarker = setupSyncState({ marker: firstMarker.toUpperCase() });
		const shortMarker = setupSyncState({ marker: firstMarker.slice(1) });
		const notHexMarker = setupSyncState({ marker: `${firstMarker.slice(1)}g` });

		const accepted = WorkOrderSyncState.safeParse(syncState);
		const badPlanId = WorkOrderSyncState.safeParse(malformedPlanId.syncState);
		const uppercase = WorkOrderSyncState.safeParse(uppercaseMarker.syncState);
		const tooShort = WorkOrderSyncState.safeParse(shortMarker.syncState);
		const notHex = WorkOrderSyncState.safeParse(notHexMarker.syncState);
		const badRecordHash = WorkOrderSyncState.safeParse({
			...syncState,
			recordSha256: recordDigest.toUpperCase(),
		});
		const noRecordHash = WorkOrderSyncState.safeParse({
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
