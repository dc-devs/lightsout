import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, WorkOrderEventKind, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import { retitleWorkOrderPlan, updateLocalWorkOrderState } from '#src/workOrder/index.ts';

/** The work order's label, which is also the branch the record below names. */
const name = 'lo-140-multi';

/**
 * No `ticket-tracker` block, so the record stays local: what a retitle promises
 * is about the record and the plan folders on disk, not about publishing.
 */
const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const firstPlan: WorkOrderState['plans'][number] = {
	id: '001-alpha-search',
	title: 'Search basics',
	progress: PlanProgress.Implemented,
	createdAt: '2026-01-01T00:00:00.000Z',
};

const secondPlan: WorkOrderState['plans'][number] = {
	id: '002-beta-fix',
	title: 'Fix search',
	progress: PlanProgress.Ready,
	createdAt: '2026-01-02T00:00:00.000Z',
};

const shipRequest = { planIds: ['001-alpha-search', '002-beta-fix'], requestedAt: '2026-01-03T00:00:00.000Z' };

const seededRecord: WorkOrderState = {
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans: [firstPlan, secondPlan],
	shipRequest,
	history: [{ at: '2026-01-02T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added plan 002-beta-fix' }],
};

/** The same ticket holding no plan at all, and so carrying no ship request either. */
const emptyRecord: WorkOrderState = {
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans: [],
	history: [],
};

/**
 * The same work order, labelled `lo-140-multi` while its plans implement on the
 * prefixed branch `feature/lo-140-multi`. A refusal composed from either field
 * reads differently, so a row on this record says which of the two it names.
 */
const prefixedBranchRecord: WorkOrderState = {
	...emptyRecord,
	branch: `feature/${name}`,
};

/**
 * A checkout outside any repository, so the shared state directory is this
 * directory's own `.lightsout`: the record is seeded through the store itself,
 * and each plan holds a file, so a renamed or recreated folder is visible.
 */
const setupTicketPlans = async ({ record = seededRecord }: { record?: WorkOrderState } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-retitle-plan-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const recordPath = join(workOrderFolder, 'state.json');

	for (const plan of record.plans) {
		mkdirSync(join(workOrderFolder, 'plans', plan.id), { recursive: true });
		writeFileSync(join(workOrderFolder, 'plans', plan.id, 'plan.md'), `# ${plan.id}\n`);
	}

	await updateLocalWorkOrderState({ cwd, name, change: () => record });

	return {
		workOrderFolder,
		recordPath,
		params: { cwd, name, config, env: {} },
	};
};

describe('retitleWorkOrderPlan', () => {
	test('changes only the display title and keeps a pending ship request', async () => {
		const { workOrderFolder, recordPath, params } = await setupTicketPlans();

		const result = await retitleWorkOrderPlan({ ...params, plan: '2', title: 'Search, rewritten' });

		expect(result).toEqual({
			record: {
				...seededRecord,
				plans: [firstPlan, { ...secondPlan, title: 'Search, rewritten' }],
				shipRequest,
				history: [...seededRecord.history, { at: expect.any(String), kind: 'plan-retitled', detail: expect.stringContaining('002-beta-fix') }],
			},
		});
		expect(JSON.parse(readFileSync(recordPath, 'utf8'))).toEqual(
			expect.objectContaining({
				plans: [firstPlan, { ...secondPlan, title: 'Search, rewritten' }],
				shipRequest,
			}),
		);
		expect(readdirSync(join(workOrderFolder, 'plans')).sort()).toStrictEqual(['001-alpha-search', '002-beta-fix']);
		expect(readFileSync(join(workOrderFolder, 'plans', '002-beta-fix', 'plan.md'), 'utf8')).toBe('# 002-beta-fix\n');
	});

	test('refuses an empty title', async () => {
		const { recordPath, params } = await setupTicketPlans();
		const before = readFileSync(recordPath, 'utf8');

		const result = await retitleWorkOrderPlan({ ...params, plan: '2', title: '   ' });

		expect(result).toEqual({ error: expect.any(String) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	// A retitle is the shortest way to the sentence that answers a plan the
	// ticket does not hold, and that sentence has two forms: the ids the ticket
	// does hold, and the admission that it holds none.
	test.each([
		{ label: 'lists the ids it does hold', record: seededRecord, plan: '9', expected: '001-alpha-search, 002-beta-fix' },
		{ label: 'says it holds none', record: emptyRecord, plan: '001-alpha-search', expected: 'holds no plans' },
	])('refuses a plan the ticket does not hold and $label', async ({ record, plan, expected }) => {
		const { recordPath, params } = await setupTicketPlans({ record });
		const before = readFileSync(recordPath, 'utf8');

		const result = await retitleWorkOrderPlan({ ...params, plan, title: 'Search, rewritten' });

		expect(result).toEqual({ error: expect.stringContaining(expected) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('names the work order by its label when the branch carries a prefix', async () => {
		const { params } = await setupTicketPlans({ record: prefixedBranchRecord });

		const result = await retitleWorkOrderPlan({ ...params, plan: '1', title: 'Search, rewritten' });

		// the sentence tells a human which work order was asked about, and that is
		// the folder's label — the branch its plans implement on is not an address
		expect(result).toEqual({ error: expect.stringContaining(`work order ${name} holds no plan`) });
		expect(result).toEqual({ error: expect.not.stringContaining('feature/') });
	});
});
