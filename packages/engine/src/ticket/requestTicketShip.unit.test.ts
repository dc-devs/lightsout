import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import {
	excludeTicketPlan,
	requestTicketShip,
	retitleTicketPlan,
	setTicketMode,
	updateLocalTicketRecord,
	withdrawTicketShipRequest,
} from '#src/ticket/index.ts';

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/**
 * No `ticket-tracker` block, so the record is local only: these rows are about
 * which plan ids a request may name, not about what reaches the tracker.
 */
const config: LightsoutConfig = { gates };
const env: NodeJS.ProcessEnv = {};
const mergeCommit = 'a1b2c3d4e5f6';

const planOf = ({ id, progress = PlanProgress.Ready, excludedFor }: { id: string; progress?: PlanProgress; excludedFor?: string }): TicketPlan => ({
	id,
	title: id,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(excludedFor === undefined ? {} : { exclusion: { at: '2026-01-02T00:00:00.000Z', reason: excludedFor, implementationRemoved: false } }),
});

/** The record the ship-request rows start from: two plans a request must cover, and one it must not name. */
const threePlans = [planOf({ id: '001-search-basics' }), planOf({ id: '002-fix-x' }), planOf({ id: '003-drop-me', excludedFor: 'superseded' })];

const setupTicketRecord = async ({
	mode = TicketMode.MultiplePlan,
	plans = threePlans,
	shipped,
}: {
	mode?: TicketMode;
	plans?: TicketPlan[];
	/** The plan ids a merged ticket shipped with, which makes the record history. */
	shipped?: string[];
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-request-ship-'));
	const record: TicketRecord = {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: ticketBranch,
		mode,
		plans,
		history: [],
		...(shipped === undefined ? {} : { shipped: { at: '2026-02-01T00:00:00.000Z', planIds: shipped, mergeCommit } }),
	};

	await updateLocalTicketRecord({ cwd, ticketBranch, change: () => record });

	const recordPath = join(cwd, '.lightsout', 'tickets', ticketBranch, 'ticket.json');

	return { recordPath, before: readFileSync(recordPath, 'utf8'), params: { cwd, ticketBranch, config, env } };
};

/** The record as it stands on disk now. */
const readRecordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord;

describe('requestTicketShip', () => {
	test('refuses every record change on a ticket whose record says it shipped', async () => {
		const { params, recordPath, before } = await setupTicketRecord({
			plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented }), planOf({ id: '002-fix-x', progress: PlanProgress.Planning })],
			shipped: ['001-search-basics'],
		});

		const results = [
			await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: true }),
			await requestTicketShip({ ...params, plans: ['001-search-basics', '002-fix-x'] }),
			await withdrawTicketShipRequest({ ...params }),
			await excludeTicketPlan({ ...params, plan: '002-fix-x', reason: 'not needed', implementationRemoved: false }),
			await retitleTicketPlan({ ...params, plan: '002-fix-x', title: 'Fix search' }),
		];

		expect(results).toEqual([
			{ error: expect.stringContaining(mergeCommit) },
			{ error: expect.stringContaining(mergeCommit) },
			{ error: expect.stringContaining(mergeCommit) },
			{ error: expect.stringContaining(mergeCommit) },
			{ error: expect.stringContaining(mergeCommit) },
		]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('stores the exact non-excluded plan ids, accepting full ids or bare numbers', async () => {
		const { params, recordPath } = await setupTicketRecord();

		const result = await requestTicketShip({ ...params, plans: ['1', '002-fix-x'] });

		const stored = readRecordAt({ recordPath });

		expect(stored).toEqual(
			expect.objectContaining({
				shipRequest: expect.objectContaining({ planIds: ['001-search-basics', '002-fix-x'] }),
				history: [expect.objectContaining({ kind: 'ship-requested' })],
			}),
		);
		expect(result).toEqual(expect.objectContaining({ record: stored }));
	});

	test('refuses a request that does not cover every non-excluded plan and names work-order exclude-plan', async () => {
		const { params, recordPath, before } = await setupTicketRecord();

		const result = await requestTicketShip({ ...params, plans: ['1'] });

		expect(result).toEqual({ error: expect.stringContaining('002-fix-x') });
		expect(result).toEqual({ error: expect.stringContaining('work-order exclude-plan') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses a request naming an excluded plan', async () => {
		const { params, recordPath, before } = await setupTicketRecord();

		const result = await requestTicketShip({ ...params, plans: ['1', '2', '3'] });

		expect(result).toEqual({ error: expect.stringContaining('003-drop-me') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses a request naming a plan the ticket does not hold', async () => {
		const { params, recordPath, before } = await setupTicketRecord();

		const result = await requestTicketShip({ ...params, plans: ['1', '2', '9'] });

		expect(result).toEqual({ error: expect.stringContaining('001-search-basics') });
		expect(result).toEqual({ error: expect.stringContaining('002-fix-x') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses a ship request outside multiple-plan mode', async () => {
		const { params, recordPath, before } = await setupTicketRecord({ mode: TicketMode.SinglePlan, plans: [planOf({ id: '001-search-basics' })] });

		const result = await requestTicketShip({ ...params, plans: ['001-search-basics'] });

		expect(result).toEqual({ error: expect.any(String) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses a request that names no plan', async () => {
		const { params, recordPath, before } = await setupTicketRecord();

		const result = await requestTicketShip({ ...params, plans: [] });

		expect(result).toEqual({ error: expect.any(String) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('requestTicketShip: the uncovered-plans and wrong-mode refusals spell the work-order command word', async () => {
		const uncovered = await setupTicketRecord();
		const singlePlan = await setupTicketRecord({ mode: TicketMode.SinglePlan, plans: [planOf({ id: '001-search-basics' })] });

		const results = [
			await requestTicketShip({ ...uncovered.params, plans: ['1'] }),
			await requestTicketShip({ ...singlePlan.params, plans: ['001-search-basics'] }),
		];

		expect(results).toEqual([
			{ error: expect.stringContaining('lightsout work-order exclude-plan') },
			{ error: expect.stringContaining('lightsout work-order mode') },
		]);
		expect(results).toEqual([{ error: expect.not.stringContaining('lightsout ticket ') }, { error: expect.not.stringContaining('lightsout ticket ') }]);
		expect(readFileSync(uncovered.recordPath, 'utf8')).toBe(uncovered.before);
		expect(readFileSync(singlePlan.recordPath, 'utf8')).toBe(singlePlan.before);
	});
});
