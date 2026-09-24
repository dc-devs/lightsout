import { describe, expect, test } from '@jest/globals';
import type { WorkOrderPlan, WorkOrderState } from '#src/contracts/index.ts';
import { readWorkOrderShipEligibility } from '#src/workOrder/index.ts';

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
		name: 'lo-140-multi',
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

/** A work order whose git branch carries a prefix its folder label does not, so a remedy cannot confuse the two names. */
const setupPrefixedBranchRecord = (): { record: WorkOrderState } => ({
	record: {
		schemaVersion: 1,
		name: 'lo-140-multi',
		branch: 'feature/lo-140-multi',
		ticketRef: 'LO-140',
		mode: 'multiple-plan',
		plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'implemented' })],
		history: [],
	},
});

/** A record carrying a build from the ticket body at the progress asked for, or none when no progress is given. */
const setupTicketBodyBuildRecord = ({
	mode,
	plans,
	progress,
	runId = 'run-body-7',
}: {
	mode: WorkOrderState['mode'];
	plans: WorkOrderPlan[];
	progress?: 'implementing' | 'implemented' | 'failed';
	runId?: string;
}): { record: WorkOrderState } => {
	const { record } = setupRecord({ mode, plans });
	const finishedAt = progress === 'implementing' ? {} : { finishedAt: '2026-01-06T00:00:00.000Z' };

	return {
		record: {
			...record,
			...(progress ? { ticketBodyBuild: { runId, progress, startedAt: '2026-01-05T00:00:00.000Z', ...finishedAt } } : {}),
		},
	};
};

describe('readWorkOrderShipEligibility', () => {
	test('never makes a ticket eligible once its record says it shipped', () => {
		const { record } = setupRecord({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'implemented' })],
			shipRequest: ['001-record', '002-queue-order'],
			shipped: { at: '2026-02-01T00:00:00.000Z', planIds: ['001-record', '002-queue-order'], mergeCommit },
		});

		const eligibility = readWorkOrderShipEligibility({ record });

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

		const implemented = readWorkOrderShipEligibility({ record: implementedRecord });
		const ready = readWorkOrderShipEligibility({ record: readyRecord });
		const excluded = readWorkOrderShipEligibility({ record: excludedRecord });

		expect(implemented).toStrictEqual({ eligible: true });
		expect(ready).toStrictEqual({ eligible: false, reason: expect.stringContaining('001-record') });
		expect(excluded).toStrictEqual({ eligible: false, reason: expect.stringContaining('001-record') });
	});

	test('refuses a single-plan ticket that holds no plan 001, so nothing supplies its implementation', () => {
		const { record } = setupRecord({ mode: 'single-plan', plans: [] });

		const eligibility = readWorkOrderShipEligibility({ record });

		expect(eligibility).toStrictEqual({ eligible: false, reason: expect.stringContaining('001') });
	});

	test('refuses a multiple-plan ticket with no ship request and names work-order request-ship', () => {
		const { record } = setupRecord({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'implemented' })],
		});

		const eligibility = readWorkOrderShipEligibility({ record });

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

		const planAdded = readWorkOrderShipEligibility({ record: planAddedRecord });
		const planExcluded = readWorkOrderShipEligibility({ record: planExcludedRecord });

		expect(planAdded).toStrictEqual({ eligible: false, reason: expect.stringContaining('003-ship-guard') });
		expect(planExcluded).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
	});

	test("refuses a satisfied request while an included plan's implementation has not finished", () => {
		const implementingRecord = setupRequestedPair({ progress: 'implementing' });
		const failedRecord = setupRequestedPair({ progress: 'failed' });
		const readyRecord = setupRequestedPair({ progress: 'ready' });

		const implementing = readWorkOrderShipEligibility({ record: implementingRecord.record });
		const failed = readWorkOrderShipEligibility({ record: failedRecord.record });
		const ready = readWorkOrderShipEligibility({ record: readyRecord.record });

		const everyReason = JSON.stringify([implementing, failed, ready]);

		expect(implementing).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
		expect(failed).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
		expect(ready).toStrictEqual({ eligible: false, reason: expect.stringContaining('002-queue-order') });
		expect(everyReason).not.toMatch(/unfinished/i);
	});

	test('readWorkOrderShipEligibility: every refusal that names a command spells the work-order command word', () => {
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

		const noRequest = readWorkOrderShipEligibility({ record: noRequestRecord });
		const uncoveredRequest = readWorkOrderShipEligibility({ record: uncoveredRequestRecord });

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
				planWith({ id: '001-record', progress: 'implemented', title: 'The work order state' }),
				planWith({ id: '002-queue-order', progress: 'implemented', title: 'Queue order' }),
				planWith({ id: '003-ship-guard', progress: 'ready', exclusion: exclusionWith({ reason: 'folded into plan 002' }) }),
			],
			shipRequest: ['001-record', '002-queue-order'],
		});
		const retitledRecord: WorkOrderState = { ...record, plans: record.plans.map((plan) => ({ ...plan, title: `${plan.title} (renamed)` })) };

		const eligibility = readWorkOrderShipEligibility({ record });
		const afterRetitle = readWorkOrderShipEligibility({ record: retitledRecord });

		expect(eligibility).toStrictEqual({ eligible: true });
		expect(afterRetitle).toStrictEqual({ eligible: true });
	});

	test('offers a request-ship remedy naming the label', () => {
		const { record } = setupPrefixedBranchRecord();

		const eligibility = readWorkOrderShipEligibility({ record });

		expect(eligibility).toStrictEqual({
			eligible: false,
			reason: expect.stringContaining('lightsout work-order request-ship --name lo-140-multi --plans 001-record,002-queue-order'),
		});
		expect(JSON.stringify(eligibility)).not.toMatch(/feature\//);
	});

	test('makes a single-plan ticket with no plan 001 eligible once its build from the ticket body is implemented', () => {
		const { record: noPlansRecord } = setupTicketBodyBuildRecord({ mode: 'single-plan', plans: [], progress: 'implemented' });
		const { record: excludedPlanTwoRecord } = setupTicketBodyBuildRecord({
			mode: 'single-plan',
			plans: [planWith({ id: '002-queue-order', progress: 'ready', exclusion: exclusionWith({ reason: 'switched to single-plan mode' }) })],
			progress: 'implemented',
		});

		const noPlans = readWorkOrderShipEligibility({ record: noPlansRecord });
		const excludedPlanTwo = readWorkOrderShipEligibility({ record: excludedPlanTwoRecord });

		expect(noPlans).toStrictEqual({ eligible: true });
		expect(excludedPlanTwo).toStrictEqual({ eligible: true });
	});

	test('refuses a single-plan ticket with no plan 001 whose build from the ticket body is missing or has not passed, naming its run', () => {
		const { record: missingRecord } = setupTicketBodyBuildRecord({ mode: 'single-plan', plans: [] });
		const { record: implementingRecord } = setupTicketBodyBuildRecord({
			mode: 'single-plan',
			plans: [],
			progress: 'implementing',
			runId: 'run-body-building',
		});
		const { record: failedRecord } = setupTicketBodyBuildRecord({ mode: 'single-plan', plans: [], progress: 'failed', runId: 'run-body-failed' });

		const missing = readWorkOrderShipEligibility({ record: missingRecord });
		const implementing = readWorkOrderShipEligibility({ record: implementingRecord });
		const failed = readWorkOrderShipEligibility({ record: failedRecord });

		expect(missing).toStrictEqual({ eligible: false, reason: expect.stringContaining('ticket body') });
		expect(missing).toStrictEqual({ eligible: false, reason: expect.stringContaining('plan 001') });
		expect(implementing).toStrictEqual({ eligible: false, reason: expect.stringContaining('run-body-building') });
		expect(failed).toStrictEqual({ eligible: false, reason: expect.stringContaining('run-body-failed') });
		expect(JSON.stringify([missing, implementing, failed])).not.toMatch(/unfinished/i);
	});

	test('ignores a ticket body build on a single-plan ticket holding plan 001 and on a multiple-plan ticket', () => {
		const { record: planOneReadyRecord } = setupTicketBodyBuildRecord({
			mode: 'single-plan',
			plans: [planWith({ id: '001-record', progress: 'ready' })],
			progress: 'implemented',
		});
		const { record: multiplePlanRecord } = setupTicketBodyBuildRecord({ mode: 'multiple-plan', plans: [], progress: 'implemented' });

		const planOneReady = readWorkOrderShipEligibility({ record: planOneReadyRecord });
		const multiplePlan = readWorkOrderShipEligibility({ record: multiplePlanRecord });

		expect(planOneReady).toStrictEqual({ eligible: false, reason: expect.stringContaining('001-record') });
		expect(multiplePlan).toStrictEqual({ eligible: false, reason: expect.stringContaining('lightsout work-order request-ship') });
	});
});
