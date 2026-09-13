import { describe, expect, test } from '@jest/globals';
import { TicketRecord } from '#src/contracts/index.ts';

const setupTicketRecord = () => {
	const implementedPlan = {
		id: '001-ticket-record',
		title: 'Ticket record',
		progress: 'implemented',
		createdAt: '2026-09-01T09:00:00.000Z',
		implementation: {
			runId: 'run-implement-001',
			startedAt: '2026-09-02T09:00:00.000Z',
			startCommit: '9c4e2f7a1b3d5e6f8091a2b3c4d5e6f708192a3b',
			finishedAt: '2026-09-02T11:30:00.000Z',
			snapshot: [{ name: 'plan.md', sha256: '5f0c1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7' }],
		},
		publishedMarker: 'c1d2e3f405162738495a6b7c8d9e0f1122334455667788990aabbccddeeff001',
	};
	const excludedPlan = {
		id: '002-plan-addressing',
		title: 'Plan addressing',
		progress: 'failed',
		createdAt: '2026-09-03T09:00:00.000Z',
		exclusion: {
			at: '2026-09-04T09:00:00.000Z',
			reason: 'switched to single-plan mode',
			implementationRemoved: true,
			verifiedCommit: '77aa1122bb3344cc5566dd7788ee99ff00112233',
		},
	};
	const record = {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: 'lo-140-support-multiple-plans-per-ticket-on-one-branch',
		mode: 'multiple-plan',
		plans: [implementedPlan, excludedPlan],
		shipRequest: { planIds: ['001-ticket-record'], requestedAt: '2026-09-05T09:00:00.000Z' },
		shipped: {
			at: '2026-09-06T09:00:00.000Z',
			planIds: ['001-ticket-record'],
			mergeCommit: '0123456789abcdef0123456789abcdef01234567',
		},
		history: [
			{ at: '2026-09-01T09:00:00.000Z', kind: 'plan-added', detail: 'added 001-ticket-record' },
			{ at: '2026-09-01T09:05:00.000Z', kind: 'plan-adopted', detail: 'adopted the legacy folder as 001-ticket-record' },
			{ at: '2026-09-01T09:10:00.000Z', kind: 'plan-retitled', detail: 'retitled 001-ticket-record to Ticket record' },
			{ at: '2026-09-04T09:00:00.000Z', kind: 'plan-excluded', detail: 'excluded 002-plan-addressing' },
			{ at: '2026-09-01T09:15:00.000Z', kind: 'mode-changed', detail: 'mode changed to multiple-plan' },
			{ at: '2026-09-05T09:00:00.000Z', kind: 'ship-requested', detail: 'ship requested for 001-ticket-record' },
			{ at: '2026-09-05T09:30:00.000Z', kind: 'ship-request-withdrawn', detail: 'withdrawn when 002-plan-addressing was added' },
			{ at: '2026-09-06T09:00:00.000Z', kind: 'shipped', detail: 'merged as 0123456789abcdef0123456789abcdef01234567' },
		],
	};

	return { record, implementedPlan, excludedPlan };
};

describe('TicketRecord', () => {
	test('accepts a full multiple-plan record and returns it unchanged', () => {
		const { record } = setupTicketRecord();

		const parsed = TicketRecord.safeParse(record);

		expect(parsed.success).toBe(true);
		expect(parsed.data).toStrictEqual(record);
	});

	test('refuses a schema version, mode or event kind outside the declared sets', () => {
		const { record } = setupTicketRecord();

		const laterSchemaVersion = TicketRecord.safeParse({ ...record, schemaVersion: 2 });
		const unknownMode = TicketRecord.safeParse({ ...record, mode: 'multi' });
		const unknownEventKind = TicketRecord.safeParse({
			...record,
			history: [{ at: '2026-09-07T09:00:00.000Z', kind: 'plan-removed', detail: 'removed 002-plan-addressing' }],
		});

		expect(laterSchemaVersion.success).toBe(false);
		expect(unknownMode.success).toBe(false);
		expect(unknownEventKind.success).toBe(false);
	});

	test('refuses plans that are not in strictly ascending number order', () => {
		const { record, implementedPlan, excludedPlan } = setupTicketRecord();

		const descendingPlans = TicketRecord.safeParse({ ...record, plans: [excludedPlan, implementedPlan] });
		const repeatedNumber = TicketRecord.safeParse({
			...record,
			plans: [implementedPlan, { ...implementedPlan, id: '001-ticket-store' }],
		});

		expect(descendingPlans.success).toBe(false);
		expect(repeatedNumber.success).toBe(false);
	});

	test('refuses a ship request naming a plan the record does not hold or naming one twice', () => {
		const { record } = setupTicketRecord();

		const unknownPlan = TicketRecord.safeParse({
			...record,
			shipRequest: { planIds: ['003-publish-and-restore'], requestedAt: '2026-09-05T09:00:00.000Z' },
		});
		const repeatedPlan = TicketRecord.safeParse({
			...record,
			shipRequest: { planIds: ['001-ticket-record', '001-ticket-record'], requestedAt: '2026-09-05T09:00:00.000Z' },
		});

		expect(unknownPlan.success).toBe(false);
		expect(repeatedPlan.success).toBe(false);
	});

	test('refuses a key the contract does not declare at the record and plan level', () => {
		const { record, implementedPlan, excludedPlan } = setupTicketRecord();

		const unknownRecordKey = TicketRecord.safeParse({ ...record, notes: 'a key no engine writes' });
		const unknownPlanKey = TicketRecord.safeParse({
			...record,
			plans: [{ ...implementedPlan, owner: 'implement' }, excludedPlan],
		});

		expect(unknownRecordKey.success).toBe(false);
		expect(unknownPlanKey.success).toBe(false);
	});
});
