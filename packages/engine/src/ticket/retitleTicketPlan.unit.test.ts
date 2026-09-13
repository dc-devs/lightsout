import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { retitleTicketPlan, updateLocalTicketRecord } from '#src/ticket/index.ts';

/** The ticket folder's name, which is also the branch the record below names. */
const ticketBranch = 'lo-140-multi';

/**
 * No `ticket-tracker` block, so the record stays local: what a retitle promises
 * is about the record and the plan folders on disk, not about publishing.
 */
const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const firstPlan: TicketRecord['plans'][number] = {
	id: '001-alpha-search',
	title: 'Search basics',
	progress: PlanProgress.Implemented,
	createdAt: '2026-01-01T00:00:00.000Z',
};

const secondPlan: TicketRecord['plans'][number] = {
	id: '002-beta-fix',
	title: 'Fix search',
	progress: PlanProgress.Ready,
	createdAt: '2026-01-02T00:00:00.000Z',
};

const shipRequest = { planIds: ['001-alpha-search', '002-beta-fix'], requestedAt: '2026-01-03T00:00:00.000Z' };

const seededRecord: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode: TicketMode.MultiplePlan,
	plans: [firstPlan, secondPlan],
	shipRequest,
	history: [{ at: '2026-01-02T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail: 'added plan 002-beta-fix' }],
};

/**
 * A checkout outside any repository, so the shared state directory is this
 * directory's own `.lightsout`: the record is seeded through the store itself,
 * and each plan holds a file, so a renamed or recreated folder is visible.
 */
const setupTicketPlans = async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-retitle-plan-'));
	const ticketFolder = join(cwd, '.lightsout', 'plans', ticketBranch);
	const recordPath = join(ticketFolder, 'ticket.json');

	for (const plan of [firstPlan, secondPlan]) {
		mkdirSync(join(ticketFolder, plan.id), { recursive: true });
		writeFileSync(join(ticketFolder, plan.id, 'plan.md'), `# ${plan.id}\n`);
	}

	await updateLocalTicketRecord({ cwd, ticketBranch, change: () => seededRecord });

	return {
		ticketFolder,
		recordPath,
		params: { cwd, ticketBranch, config, env: {} },
	};
};

describe('retitleTicketPlan', () => {
	test('changes only the display title and keeps a pending ship request', async () => {
		const { ticketFolder, recordPath, params } = await setupTicketPlans();

		const result = await retitleTicketPlan({ ...params, plan: '2', title: 'Search, rewritten' });

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
		expect(readdirSync(ticketFolder).sort()).toStrictEqual(['001-alpha-search', '002-beta-fix', 'ticket.json']);
		expect(readFileSync(join(ticketFolder, '002-beta-fix', 'plan.md'), 'utf8')).toBe('# 002-beta-fix\n');
	});

	test('refuses an empty title', async () => {
		const { recordPath, params } = await setupTicketPlans();
		const before = readFileSync(recordPath, 'utf8');

		const result = await retitleTicketPlan({ ...params, plan: '2', title: '   ' });

		expect(result).toEqual({ error: expect.any(String) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});
});
