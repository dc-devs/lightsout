import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { WorkOrderPlan, WorkOrderState } from '#src/contracts/index.ts';
import { readTicketRunTerms } from '#src/ticket/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';

const ticketBranch = 'lo-140-multi';

const planWith = ({ id, progress }: { id: string; progress: WorkOrderPlan['progress'] }): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
});

/** A plan's `--name`: the ticket-branch segment and the plan id, the form every plan command takes. */
const addressOf = ({ planId }: { planId: string }) => `${ticketBranch}/${planId}`;

/** The path a run manifest records for one file of a ticket plan's folder. */
const planFileOf = ({ planId, file }: { planId: string; file: string }) => `.lightsout/tickets/${ticketBranch}/plans/${planId}/${file}`;

/** A checkout with no repository above it, so its own `.lightsout` folder is the one the record is looked for in. */
const makeCheckout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-terms-'));

	mkdirSync(planWorkspaceFolder({ cwd: cwd, name: ticketBranch }), { recursive: true });

	return { cwd, recordPath: join(cwd, '.lightsout', 'tickets', ticketBranch, 'ticket.json') };
};

/** A checkout whose ticket folder exists but holds no `ticket.json`, which is what makes a folder legacy. */
const setupWithoutRecord = (): { cwd: string } => {
	const { cwd } = makeCheckout();

	return { cwd };
};

const setupTicket = ({ mode, plans, shipRequest }: { mode: WorkOrderState['mode']; plans: WorkOrderPlan[]; shipRequest?: string[] }): { cwd: string } => {
	const { cwd, recordPath } = makeCheckout();
	const record: WorkOrderState = {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: ticketBranch,
		mode,
		plans,
		...(shipRequest ? { shipRequest: { planIds: shipRequest, requestedAt: '2026-01-05T00:00:00.000Z' } } : {}),
		history: [],
	};

	writeFileSync(recordPath, JSON.stringify(record));

	return { cwd };
};

/** A ticket folder whose `ticket.json` is not JSON at all, the shape a hand edit or a half-copied file leaves. */
const setupCorruptRecord = (): { cwd: string; recordPath: string } => {
	const { cwd, recordPath } = makeCheckout();

	writeFileSync(recordPath, '{ this is not json');

	return { cwd, recordPath };
};

describe('readTicketRunTerms', () => {
	test('answers no terms for a legacy folder, a plan outside the plans directory and a ticket with no record', async () => {
		const { cwd } = setupWithoutRecord();

		const legacyFolder = await readTicketRunTerms({
			cwd,
			name: 'lo-139-legacy-folder',
			planPath: '.lightsout/tickets/lo-139-legacy-folder/plans/plan.md',
		});
		const outsideThePlansDirectory = await readTicketRunTerms({ cwd, name: undefined, planPath: undefined });
		const ticketWithNoRecord = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '001-record' }),
			planPath: planFileOf({ planId: '001-record', file: 'plan.md' }),
		});

		// An answer carrying neither field says the same thing whether the fields
		// are absent or present and undefined, so the comparison ignores undefined.
		expect({ legacyFolder, outsideThePlansDirectory, ticketWithNoRecord }).toEqual({
			legacyFolder: {},
			outsideThePlansDirectory: {},
			ticketWithNoRecord: {},
		});
	});

	test("leaves a single-plan ticket's shipping to --ship and ship.after-implement", async () => {
		const { cwd } = setupTicket({ mode: 'single-plan', plans: [planWith({ id: '001-record', progress: 'ready' })] });

		const terms = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '001-record' }),
			planPath: planFileOf({ planId: '001-record', file: 'plan.md' }),
		});

		expect(terms).toEqual({});
	});

	test('answers a satisfied ship request for the run that implements the last included plan', async () => {
		const { cwd } = setupTicket({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'ready' })],
			shipRequest: ['001-record', '002-queue-order'],
		});

		const terms = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '002-queue-order' }),
			planPath: planFileOf({ planId: '002-queue-order', file: 'plan.md' }),
		});

		expect(terms).toEqual({ shipRequest: { blocker: undefined } });
	});

	test('answers a blocker when a multiple-plan ticket has no ship request', async () => {
		const { cwd } = setupTicket({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'ready' })],
		});

		const terms = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '002-queue-order' }),
			planPath: planFileOf({ planId: '002-queue-order', file: 'plan.md' }),
		});

		expect(terms).toEqual({ shipRequest: { blocker: expect.stringContaining('ship request') } });
	});

	test('answers a blocker naming the included plans a run of this plan leaves not implemented', async () => {
		const { cwd } = setupTicket({
			mode: 'multiple-plan',
			plans: [
				planWith({ id: '001-record', progress: 'implemented' }),
				planWith({ id: '002-queue-order', progress: 'ready' }),
				planWith({ id: '003-ship-guard', progress: 'ready' }),
			],
			shipRequest: ['001-record', '002-queue-order', '003-ship-guard'],
		});

		const terms = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '002-queue-order' }),
			planPath: planFileOf({ planId: '002-queue-order', file: 'plan.md' }),
		});

		expect(terms).toEqual({ shipRequest: { blocker: expect.stringContaining('003-ship-guard') } });
		expect(terms.shipRequest?.blocker).not.toMatch(/unfinished/i);
	});

	test('holds back the ship chain for a run of one phase file of a ticket plan', async () => {
		const { cwd } = setupTicket({ mode: 'single-plan', plans: [planWith({ id: '001-record', progress: 'ready' })] });

		const onePhase = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '001-record' }),
			planPath: planFileOf({ planId: '001-record', file: 'phase2-plan-addressing.md' }),
		});
		const wholePlan = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '001-record' }),
			planPath: planFileOf({ planId: '001-record', file: 'overview.md' }),
		});

		expect({ onePhase, wholePlan }).toEqual({
			onePhase: { shipRequest: { blocker: expect.stringContaining('has not finished') } },
			wholePlan: {},
		});
		expect(onePhase.shipRequest?.blocker).not.toMatch(/unfinished/i);
	});

	test('answers the refusal for a plan whose lower-numbered plan is not implemented', async () => {
		const { cwd } = setupTicket({
			mode: 'multiple-plan',
			plans: [planWith({ id: '001-record', progress: 'ready' }), planWith({ id: '002-queue-order', progress: 'ready' })],
		});

		const terms = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '002-queue-order' }),
			planPath: planFileOf({ planId: '002-queue-order', file: 'plan.md' }),
		});

		expect(terms.refusal).toEqual(expect.stringContaining('001-record'));
	});

	test('answers a refusal and a ship blocker when the ticket record cannot be read', async () => {
		const { cwd, recordPath } = setupCorruptRecord();

		const terms = await readTicketRunTerms({
			cwd,
			name: addressOf({ planId: '001-record' }),
			planPath: planFileOf({ planId: '001-record', file: 'plan.md' }),
		});

		expect(terms).toEqual({
			refusal: expect.stringContaining(recordPath),
			shipRequest: { blocker: expect.stringContaining(recordPath) },
		});
	});
});
