import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import { withdrawWorkOrderShipRequest } from '#src/workOrder/withdrawWorkOrderShipRequest.ts';

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/**
 * A multiple-plan record holding two plans, with the human's ship request
 * pending or never made. No `ticket-tracker` block is configured in these rows,
 * so the record stays local and nothing is published.
 */
const recordOf = ({ pending }: { pending: boolean }): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: 'multiple-plan',
	plans: [
		{ id: '001-record', title: 'The work order state', progress: 'implemented', createdAt: '2026-01-01T00:00:00.000Z' },
		{ id: '002-queue-order', title: 'Queue order', progress: 'ready', createdAt: '2026-01-02T00:00:00.000Z' },
	],
	...(pending ? { shipRequest: { planIds: ['001-record', '002-queue-order'], requestedAt: '2026-01-03T00:00:00.000Z' } } : {}),
	history: [
		{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-record' },
		{ at: '2026-01-02T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 002-queue-order' },
		...(pending ? ([{ at: '2026-01-03T00:00:00.000Z', kind: 'ship-requested', detail: 'requested 001-record, 002-queue-order' }] as const) : []),
	],
});

/** Seeds the record through the store itself, so the bytes on disk are the exact form a real machine holds. */
const setupShipRequest = async ({ pending = true }: { pending?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-withdraw-ship-'));
	const recordPath = join(cwd, '.lightsout', 'work-orders', name, 'state.json');

	await updateLocalWorkOrderState({ cwd, name, change: () => recordOf({ pending }) });

	return { recordPath, params: { cwd, name, config: { gates }, env: {} } };
};

describe('withdrawWorkOrderShipRequest', () => {
	test('clears a pending ship request and records its withdrawal', async () => {
		const { params, recordPath } = await setupShipRequest({ pending: true });

		const result = await withdrawWorkOrderShipRequest(params);

		const written = JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState;

		expect(result).toEqual(expect.objectContaining({ record: written }));
		expect(written.shipRequest).toBeUndefined();
		// Append-only: the request that was made stays readable beside its withdrawal.
		expect(written.history.map((event) => event.kind)).toStrictEqual(['plan-added', 'plan-added', 'ship-requested', 'ship-request-withdrawn']);
	});

	test('refuses when no ship request is pending', async () => {
		const { params, recordPath } = await setupShipRequest({ pending: false });
		const before = readFileSync(recordPath, 'utf8');

		const result = await withdrawWorkOrderShipRequest(params);

		expect(result).toEqual({ error: expect.any(String) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});
});
