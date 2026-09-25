import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';
import { setWorkOrderMode } from '#src/workOrder/setWorkOrderMode.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';

/** The work order's label: the folder it sits in, and the name every command addresses it by. */
const label = 'lo-140-multi';

/**
 * The git branch its plans implement on, carrying a prefix the label does not.
 * Every row below turns on the difference: a sentence built from the branch
 * would carry `feature/`, and one built from the label cannot.
 */
const branch = `feature/${label}`;
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

const planWith = ({ id, progress = PlanProgress.Planning }: { id: string; progress?: PlanProgress }): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-03-01T00:00:00.000Z',
});

/**
 * A checkout outside any repository, holding one work order whose label and
 * branch are different strings. No `ticket-tracker` block is configured, so the
 * record stays local and every sentence asserted below is this machine's own.
 */
const setupPrefixedBranch = async ({
	plans = [],
	shipRequest,
}: {
	plans?: WorkOrderPlan[];
	/** The pending ship request the record starts with. */
	shipRequest?: WorkOrderState['shipRequest'];
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-label-'));
	const record: WorkOrderState = {
		schemaVersion: 1,
		name: label,
		ticketRef: 'LO-140',
		branch,
		mode: WorkOrderMode.MultiplePlan,
		plans,
		...(shipRequest === undefined ? {} : { shipRequest }),
		history: [],
	};

	await updateLocalWorkOrderState({ cwd, name: label, change: () => record });

	return {
		params: { cwd, name: label, config: { gates, ship: { 'after-implement': false } } satisfies LightsoutConfig, env: {} },
	};
};

/** The refusal sentence, or an empty string when the switch went through. */
const errorOf = ({ outcome }: { outcome: WorkOrderStateChange | { error: string } }) => ('error' in outcome ? outcome.error : '');

/** Every sentence the switch recorded in the work order's history. */
const detailsOf = ({ outcome }: { outcome: WorkOrderStateChange | { error: string } }) =>
	'error' in outcome ? [] : outcome.record.history.map((event) => event.detail);

describe('setWorkOrderMode', () => {
	test('names the work order by its label in the single-plan preview when the branch carries a prefix', async () => {
		const { params } = await setupPrefixedBranch({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order' })],
		});

		const result = await setWorkOrderMode({ ...params, mode: WorkOrderMode.SinglePlan, approve: false });

		const preview = errorOf({ outcome: result });

		expect(preview).toContain('lo-140-multi');
		expect(preview).not.toContain('feature/');
	});

	test('names the work order by its label in every event an approved switch records', async () => {
		const { params } = await setupPrefixedBranch({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order' })],
			shipRequest: { planIds: ['001-record', '002-queue-order'], requestedAt: '2026-03-04T09:00:00.000Z' },
		});

		const result = await setWorkOrderMode({ ...params, mode: WorkOrderMode.SinglePlan, approve: true });

		const details = detailsOf({ outcome: result });

		// The exclusion, the withdrawal and the mode change are three sentences one
		// human reads later, and none of them is about a git branch.
		expect(details).toEqual([expect.stringContaining('lo-140-multi'), expect.stringContaining('lo-140-multi'), expect.stringContaining('lo-140-multi')]);
		expect(details.join('\n')).not.toContain('feature/');
	});

	test('names the work order by its label when a later plan carries an unaccounted implementation', async () => {
		const { params } = await setupPrefixedBranch({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order', progress: PlanProgress.Implemented })],
		});

		const result = await setWorkOrderMode({ ...params, mode: WorkOrderMode.SinglePlan, approve: true });

		const refusal = errorOf({ outcome: result });

		expect(refusal).toContain('lo-140-multi');
		expect(refusal).not.toContain('feature/');
	});

	test('names the work order by its label when it holds no plan 001', async () => {
		const { params } = await setupPrefixedBranch({ plans: [planWith({ id: '002-queue-order', progress: PlanProgress.Ready })] });

		const result = await setWorkOrderMode({ ...params, mode: WorkOrderMode.SinglePlan, approve: true });

		const refusal = errorOf({ outcome: result });

		expect(refusal).toContain('lo-140-multi holds no plan 001');
		expect(refusal).not.toContain('feature/');
	});

	test('names the work order by its label when plan 001 is excluded', async () => {
		const { params } = await setupPrefixedBranch({
			plans: [
				{
					...planWith({ id: '001-record', progress: PlanProgress.Ready }),
					exclusion: { at: '2026-03-05T09:00:00.000Z', reason: 'replaced by a later plan', implementationRemoved: false },
				},
				planWith({ id: '002-queue-order', progress: PlanProgress.Ready }),
			],
		});

		const result = await setWorkOrderMode({ ...params, mode: WorkOrderMode.SinglePlan, approve: true });

		const refusal = errorOf({ outcome: result });

		expect(refusal).toContain('001-record');
		expect(refusal).toContain('lo-140-multi');
		expect(refusal).not.toContain('feature/');
	});
});
