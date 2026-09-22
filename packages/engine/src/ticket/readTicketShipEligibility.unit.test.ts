import { describe, expect, test } from '@jest/globals';
import type { WorkOrderPlan, WorkOrderState } from '#src/contracts/index.ts';
import { readTicketShipEligibility } from '#src/ticket/index.ts';

const mergeCommit = '9c4e2f7a1b3d5e6f8091a2b3c4d5e6f708192a3b';

const planWith = ({
	id,
	progress,
	title = `Plan ${id}`,
	exclusion,
}: {
	id: string;
	progress: WorkOrderPlan['progress'];
	title?: string;
	exclusion?: WorkOrderPlan['exclusion'];
}): WorkOrderPlan => ({
	id,
	title,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(exclusion ? { exclusion } : {}),
});

/** An exclusion whose implementation never started, so it carries no verified commit. */
const exclusionWith = ({ reason }: { reason: string }): WorkOrderPlan['exclusion'] => ({
	at: '2026-01-04T00:00:00.000Z',
	reason,
	implementationRemoved: false,
});

const setupRecord = ({
	mode,
	plans,
	shipRequest,
	shipped,
}: {
	mode: WorkOrderState['mode'];
	plans: WorkOrderPlan[];
	shipRequest?: string[];
	shipped?: WorkOrderState['shipped'];
}): { record: WorkOrderState } => ({
	record: {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: 'lo-140-multi',
		mode,
		plans,
		...(shipRequest ? { shipRequest: { planIds: shipRequest, requestedAt: '2026-01-05T00:00:00.000Z' } } : {}),
		...(shipped ? { shipped } : {}),
		history: [],
	},
});

/** A multiple-plan ticket whose request covers both its plans, the second one at the progress asked for. */
const setupRequestedPair = ({ progress }: { progress: WorkOrderPlan['progress'] }): { record: WorkOrderState } =>
	setupRecord({
		mode: 'multiple-plan',
		plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress })],
		shipRequest: ['001-record', '002-queue-order'],
	});

describe('readTicketShipEligibility', () => {
	test('never makes a ticket eligible once its record says it shipped', () => {
		const { record } = setupRecord({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'implemented' })],
			shipRequest: ['001-record', '002-queue-order'],
			shipped: { at: '2026-02-01T00:00:00.000Z', planIds: ['001-record', '002-queue-order'], mergeCommit },
		});

		const eligibility = readTicketShipEligibility({ record });

		expect(eligibility).toStrictEqual({ eligible: false, reason: expect.stringContaining(mergeCommit) });
	});

	test('makes a single-plan ticket eligible exactly when plan 001 is implemented', () => {
		const { record: implementedRecord } = setupRecord({
			mode: 'single-plan',
			plans: [
				planWith({ id: '001-record', progress: 'implemented' }),
				planWith({ id: '002-queue-order', progress: 'ready', exclusion: exclusionWith({ reason: 'switched to single-plan mode' }) }),
			],
		});
		const { record: readyRecord } = setupRecord({ mode: 'single-plan', plans: [planWith({ id: '001-record', progress: 'ready' })] });
		const { record: excludedRecord } = setupRecord({
			mode: 'single-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented', exclusion: exclusionWith({ reason: 'replaced by a follow-up plan' }) })],
		});

		const implemented = readTicketShipEligibility({ record: implementedRecord });
		const ready = readTicketShipEligibility({ record: readyRecord });
		const excluded = readTicketShipEligibility({ record: excludedRecord });

		expect(implemented).toStrictEqual({ eligible: true });
		expect(ready).toStrictEqual({ eligible: false, reason: expect.stringContaining('001-record') });
		expect(excluded).toStrictEqual({ eligible: false, reason: expect.stringContaining('001-record') });
	});

	test('refuses a single-plan ticket that holds no plan 001, so nothing supplies its implementation', () => {
		const { record } = setupRecord({ mode: 'single-plan', plans: [] });

		const eligibility = readTicketShipEligibility({ record });

		expect(eligibility).toStrictEqual({ eligible: false, reason: expect.stringContaining('001') });
	});

	test('refuses a multiple-plan ticket with no ship request and names work-order request-ship', () => {
		const { record } = setupRecord({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'implemented' })],
		});

		const eligibility = readTicketShipEligibility({ record });

		expect(eligibility).toStrictEqual({ eligible: false, reason: expect.stringContaining('lightsout work-order request-ship') });
	});

	test('refuses a ship request whose ids differ from the plans without an exclusion and names the difference', () => {
		const { record: planAddedRecord } = setupRecord({
			mode: 'multiple-plan',
			plans: [
				planWith({ id: '001-record', progress: 'implemented' }),
				planWith({ id: '002-queue-order', progress: 'implemented' }),
				planWith({ id: '003-ship-guard', progress: 'ready' }),
			],
			shipRequest: ['001-record', '002-queue-order'],
		});
		const { record: planExcludedRecord } = setupRecord({
			mode: 'multiple-plan',
			plans: [
				planWith({ id: '001-record', progress: 'implemented' }),
				planWith({ id: '002-queue-order', progress: 'failed', exclusion: exclusionWith({ reason: 'implementation removed on the branch' }) }),
			],
			shipRequest: ['001-record', '002-queue-order'],
		});

		const planAdded = readTicketShipEligibility({ record: planAddedRecord });
		const planExcluded = readTicketShipEligibility({ record: planExcludedRecord });

		expect(planAdded).toStrictEqual({ eligible: false, reason: expect.stringContaining('003-ship-guard') });
		expect(planExcluded).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
	});

	test("refuses a satisfied request while an included plan's implementation has not finished", () => {
		const implementingRecord = setupRequestedPair({ progress: 'implementing' });
		const failedRecord = setupRequestedPair({ progress: 'failed' });
		const readyRecord = setupRequestedPair({ progress: 'ready' });

		const implementing = readTicketShipEligibility({ record: implementingRecord.record });
		const failed = readTicketShipEligibility({ record: failedRecord.record });
		const ready = readTicketShipEligibility({ record: readyRecord.record });

		const everyReason = JSON.stringify([implementing, failed, ready]);

		expect(implementing).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
		expect(failed).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
		expect(ready).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
		expect(everyReason).not.toMatch(/unfinished/i);
	});

	test('readTicketShipEligibility: every refusal that names a command spells the work-order command word', () => {
		const { record: noRequestRecord } = setupRecord({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'implemented' })],
		});
		const { record: uncoveredRequestRecord } = setupRecord({
			mode: 'multiple-plan',
			plans: [
				planWith({ id: '001-record', progress: 'implemented' }),
				planWith({ id: '002-queue-order', progress: 'implemented' }),
				planWith({ id: '003-ship-guard', progress: 'implemented' }),
			],
			shipRequest: ['001-record', '002-queue-order'],
		});

		const noRequest = readTicketShipEligibility({ record: noRequestRecord });
		const uncoveredRequest = readTicketShipEligibility({ record: uncoveredRequestRecord });

		expect(noRequest).toStrictEqual({
			eligible: false,
			reason: expect.stringContaining('lightsout work-order request-ship --name lo-140-multi --plans 001-record,002-queue-order'),
		});
		expect(uncoveredRequest).toStrictEqual({
			eligible: false,
			reason: expect.stringContaining('lightsout work-order request-ship --name lo-140-multi --plans 001-record,002-queue-order,003-ship-guard'),
		});
		expect(JSON.stringify([noRequest, uncoveredRequest])).not.toMatch(/lightsout ticket /);
	});

	test('makes a multiple-plan ticket eligible when its request covers every included implemented plan whatever their titles', () => {
		const { record } = setupRecord({
			mode: 'multiple-plan',
			plans: [
				planWith({ id: '001-record', progress: 'implemented', title: 'The ticket record' }),
				planWith({ id: '002-queue-order', progress: 'implemented', title: 'Queue order' }),
				planWith({ id: '003-ship-guard', progress: 'ready', exclusion: exclusionWith({ reason: 'folded into plan 002' }) }),
			],
			shipRequest: ['001-record', '002-queue-order'],
		});
		const retitledRecord: WorkOrderState = { ...record, plans: record.plans.map((plan) => ({ ...plan, title: `${plan.title} (renamed)` })) };

		const eligibility = readTicketShipEligibility({ record });
		const afterRetitle = readTicketShipEligibility({ record: retitledRecord });

		expect(eligibility).toStrictEqual({ eligible: true });
		expect(afterRetitle).toStrictEqual({ eligible: true });
	});
});
