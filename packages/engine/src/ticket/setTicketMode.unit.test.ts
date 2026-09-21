import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, TicketEventKind, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import { setTicketMode, type TicketRecordChange, updateLocalTicketRecord } from '#src/ticket/index.ts';

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/**
 * One plan of the record, carrying only what a mode switch reads: its id, how
 * far its implementation got, and the exclusion that takes it out of the
 * ticket's implementation order.
 */
const planWith = ({
	id,
	progress = PlanProgress.Planning,
	exclusion,
}: {
	id: string;
	progress?: PlanProgress;
	exclusion?: TicketPlan['exclusion'];
}): TicketPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-03-01T00:00:00.000Z',
	...(exclusion === undefined ? {} : { exclusion }),
});

/**
 * A checkout outside any repository, so the shared state directory is this
 * directory's own `.lightsout` and the record is a file the test can read byte
 * for byte. No `ticket-tracker` block is configured, so the synced store keeps
 * the record local and every assertion below is about this machine's own bytes.
 */
const setupTicketMode = async ({
	mode = TicketMode.MultiplePlan,
	plans = [],
	shipRequest,
	afterImplement = false,
	seeded = true,
	ticketPattern,
}: {
	mode?: TicketMode;
	plans?: TicketPlan[];
	/** The pending ship request the record starts with. */
	shipRequest?: TicketRecord['shipRequest'];
	/** The repository's `ship.after-implement` value, which the preview has to describe. */
	afterImplement?: boolean;
	/** False leaves the ticket with no record at all. */
	seeded?: boolean;
	/** The repository's `ship.ticket-pattern`, left out so the default applies. */
	ticketPattern?: string;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-mode-'));
	const recordPath = join(cwd, '.lightsout', 'tickets', ticketBranch, 'ticket.json');
	const record: TicketRecord = {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: ticketBranch,
		mode,
		plans,
		...(shipRequest === undefined ? {} : { shipRequest }),
		history: [],
	};

	if (seeded) {
		await updateLocalTicketRecord({ cwd, ticketBranch, change: () => record });
	}

	return {
		cwd,
		recordPath,
		/** The record's bytes before the act, so a row can prove nothing was written. */
		before: seeded ? readFileSync(recordPath, 'utf8') : undefined,
		params: {
			cwd,
			ticketBranch,
			config: {
				gates,
				ship: { 'after-implement': afterImplement, ...(ticketPattern === undefined ? {} : { 'ticket-pattern': ticketPattern }) },
			} satisfies LightsoutConfig,
			env: {},
		},
	};
};

/** The record as it stands on disk, which is what every later command reads. */
const writtenRecordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord;

/** The refusal sentence, or an empty string when the switch went through. */
const errorOf = ({ outcome }: { outcome: TicketRecordChange | { error: string } }) => ('error' in outcome ? outcome.error : '');

const planOf = ({ record, id }: { record: TicketRecord; id: string }) => record.plans.find((plan) => plan.id === id);

describe('setTicketMode', () => {
	test('switches a single-plan ticket to multiple-plan mode and says a ship request is now needed', async () => {
		const { params, recordPath } = await setupTicketMode({
			mode: TicketMode.SinglePlan,
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready })],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.MultiplePlan, approve: false });

		const written = writtenRecordAt({ recordPath });

		expect(result).toEqual(
			expect.objectContaining({
				record: expect.objectContaining({ mode: 'multiple-plan' }),
				notice: expect.stringContaining('work-order request-ship'),
			}),
		);
		expect(written.mode).toBe('multiple-plan');
		expect(written.history.map((event) => event.kind)).toStrictEqual([TicketEventKind.ModeChanged]);
	});

	test('previews the switch to single-plan mode without --approve, naming the later plans, and changes nothing', async () => {
		const { params, recordPath, before } = await setupTicketMode({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order' })],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: false });

		expect(errorOf({ outcome: result })).toContain('002-queue-order');
		expect(errorOf({ outcome: result })).toContain('--approve');
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('states what ship.after-implement means for this ticket in the preview', async () => {
		const plans = [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order' })];
		const chaining = await setupTicketMode({ plans, afterImplement: true });
		const manual = await setupTicketMode({ plans, afterImplement: false });

		// The criterion is a comparison: the same preview text for both values of
		// the setting would tell the human nothing about their own repository.
		const chainingPreview = errorOf({ outcome: await setTicketMode({ ...chaining.params, mode: TicketMode.SinglePlan, approve: false }) });
		const manualPreview = errorOf({ outcome: await setTicketMode({ ...manual.params, mode: TicketMode.SinglePlan, approve: false }) });

		expect(chainingPreview).toContain('ship.after-implement');
		expect(chainingPreview).toMatch(/implement/i);
		expect(manualPreview).toContain('ship.after-implement');
		expect(manualPreview).toContain('lightsout ship');
		expect(chainingPreview).not.toBe(manualPreview);
		// Both have to say the queue ships the branch once plan 001 is implemented,
		// whatever the setting says.
		expect(chainingPreview).toMatch(/queue/i);
		expect(manualPreview).toMatch(/queue/i);
		expect(chainingPreview).toMatch(/implemented/i);
		expect(manualPreview).toMatch(/implemented/i);
	});

	test('says an already implemented plan 001 becomes eligible to ship once the switch is approved', async () => {
		const { params } = await setupTicketMode({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented }), planWith({ id: '002-queue-order', progress: PlanProgress.Ready })],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: false });

		const preview = errorOf({ outcome: result });

		expect(preview).toMatch(/eligible/i);
		expect(preview).toMatch(/approv/i);
		expect(preview).toContain('lightsout ship');
		expect(preview).toMatch(/queue/i);
		// Nothing ships the moment the mode changes, so the dropped 'at once'
		// wording must not come back.
		expect(preview).not.toMatch(/at once/i);
	});

	test('with --approve excludes every later plan, withdraws the ship request and records the switch', async () => {
		const { params, recordPath } = await setupTicketMode({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order' }), planWith({ id: '003-ship-guard' })],
			shipRequest: { planIds: ['001-record', '002-queue-order', '003-ship-guard'], requestedAt: '2026-03-04T09:00:00.000Z' },
		});

		await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: true });

		const written = writtenRecordAt({ recordPath });

		expect(written.mode).toBe('single-plan');
		expect(written.shipRequest).toBeUndefined();
		expect(planOf({ record: written, id: '001-record' })?.exclusion).toBeUndefined();
		expect(planOf({ record: written, id: '002-queue-order' })?.exclusion).toEqual(
			expect.objectContaining({ implementationRemoved: false, reason: expect.stringContaining('single-plan') }),
		);
		expect(planOf({ record: written, id: '003-ship-guard' })?.exclusion).toEqual(
			expect.objectContaining({ implementationRemoved: false, reason: expect.stringContaining('single-plan') }),
		);
		expect(written.history.map((event) => event.kind)).toStrictEqual([
			TicketEventKind.PlanExcluded,
			TicketEventKind.PlanExcluded,
			TicketEventKind.ShipRequestWithdrawn,
			TicketEventKind.ModeChanged,
		]);
		expect(written.history[0]?.detail).toContain('002-queue-order');
		expect(written.history[1]?.detail).toContain('003-ship-guard');
	});

	test("refuses the switch to single-plan mode while a later plan's implementation has started", async () => {
		const { params, recordPath, before } = await setupTicketMode({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order', progress: PlanProgress.Implemented })],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: true });

		expect(errorOf({ outcome: result })).toContain('002-queue-order');
		expect(errorOf({ outcome: result })).toContain('work-order exclude-plan --implementation-removed');
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('allows the switch once every started later plan is excluded with its implementation removed and verified', async () => {
		const { params, recordPath } = await setupTicketMode({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Ready }),
				planWith({
					id: '002-queue-order',
					progress: PlanProgress.Implemented,
					exclusion: { at: '2026-03-05T09:00:00.000Z', reason: 'its implementation was removed', implementationRemoved: true, verifiedCommit: 'c0ffee1' },
				}),
			],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: false });

		const written = writtenRecordAt({ recordPath });

		expect(result).toEqual(expect.objectContaining({ record: expect.objectContaining({ mode: 'single-plan' }) }));
		expect(written.mode).toBe('single-plan');
		expect(written.history.map((event) => event.kind)).toStrictEqual([TicketEventKind.ModeChanged]);
		expect(planOf({ record: written, id: '002-queue-order' })?.exclusion).toStrictEqual({
			at: '2026-03-05T09:00:00.000Z',
			reason: 'its implementation was removed',
			implementationRemoved: true,
			verifiedCommit: 'c0ffee1',
		});
	});

	test('refuses the switch while an excluded later plan records a removal no commit verifies', async () => {
		// The other half of the same rule: an exclusion that claims the code is
		// gone but carries no commit the gates passed on proves nothing, so the
		// implementation is still unaccounted for and the switch is still refused.
		const { params, recordPath, before } = await setupTicketMode({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Ready }),
				planWith({
					id: '002-queue-order',
					progress: PlanProgress.Implemented,
					exclusion: { at: '2026-03-05T09:00:00.000Z', reason: 'its implementation was removed', implementationRemoved: true },
				}),
			],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: true });

		expect(errorOf({ outcome: result })).toContain('002-queue-order');
		expect(errorOf({ outcome: result })).toContain('work-order exclude-plan --implementation-removed');
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses the switch to single-plan mode when plan 001 is missing or excluded', async () => {
		const excluded = await setupTicketMode({
			plans: [
				planWith({
					id: '001-record',
					progress: PlanProgress.Ready,
					exclusion: { at: '2026-03-05T09:00:00.000Z', reason: 'replaced by a later plan', implementationRemoved: false },
				}),
				planWith({ id: '002-queue-order', progress: PlanProgress.Ready }),
			],
		});
		// The other half of the same criterion: a ticket whose numbering starts
		// above 001 has no plan to put in single-plan mode's one seat at all.
		const missing = await setupTicketMode({ plans: [planWith({ id: '002-queue-order', progress: PlanProgress.Ready })] });

		const afterExcluded = await setTicketMode({ ...excluded.params, mode: TicketMode.SinglePlan, approve: true });
		const afterMissing = await setTicketMode({ ...missing.params, mode: TicketMode.SinglePlan, approve: true });

		expect(errorOf({ outcome: afterExcluded })).toContain('001-record');
		expect(errorOf({ outcome: afterMissing })).toContain('001');
		expect(readFileSync(excluded.recordPath, 'utf8')).toBe(excluded.before);
		expect(readFileSync(missing.recordPath, 'utf8')).toBe(missing.before);
	});

	test('refuses the switch when ship.ticket-pattern cannot say what a branch ships, and names the key', async () => {
		// A pattern that compiles but captures no `ticket` group: the repository
		// cannot read a ticket id out of any branch, so nothing here can be said
		// about what this ticket would ship.
		const { params, recordPath, before } = await setupTicketMode({
			ticketPattern: '^(lo-\\d+)',
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order' })],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: true });

		expect(errorOf({ outcome: result })).toContain('ship.ticket-pattern');
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses a switch to the mode the ticket already has', async () => {
		const { params, recordPath, before } = await setupTicketMode({
			mode: TicketMode.SinglePlan,
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready })],
		});

		const result = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: false });

		expect(errorOf({ outcome: result })).toContain('single-plan');
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses a ticket with no record and names only work-order add-plan', async () => {
		const { params, recordPath } = await setupTicketMode({ seeded: false });

		// The criterion covers both directions: neither may create a record.
		const toSingle = await setTicketMode({ ...params, mode: TicketMode.SinglePlan, approve: false });
		const toMultiple = await setTicketMode({ ...params, mode: TicketMode.MultiplePlan, approve: false });

		// A folder with no record is either a ticket nobody has started or one
		// whose plans folder already holds loose files, and one command starts a
		// plan either way — the second form naming the folder those files are in.
		expect(errorOf({ outcome: toSingle })).toContain(`there is no ticket record for '${ticketBranch}'`);
		expect(errorOf({ outcome: toSingle })).toContain(`lightsout work-order add-plan --name ${ticketBranch} --slug <slug>`);
		expect(errorOf({ outcome: toSingle })).toContain(`--from ${ticketBranch}`);
		// The refusal must never name a word the dispatcher now rejects.
		expect(errorOf({ outcome: toSingle })).not.toMatch(/adopt/i);
		// Two spellings of one refusal would soon name different commands, so both
		// directions have to answer the very same sentence.
		expect(errorOf({ outcome: toMultiple })).toBe(errorOf({ outcome: toSingle }));
		expect(existsSync(recordPath)).toBe(false);
	});

	test('setTicketMode: the unaccounted-implementation refusal and the multiple-plan notice spell the work-order command word', async () => {
		const unaccounted = await setupTicketMode({
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready }), planWith({ id: '002-queue-order', progress: PlanProgress.Implemented })],
		});
		// The other half of the criterion: a ticket already in single-plan mode, so
		// the switch goes through and answers the notice rather than a refusal.
		const toMultiple = await setupTicketMode({
			mode: TicketMode.SinglePlan,
			plans: [planWith({ id: '001-record', progress: PlanProgress.Ready })],
		});

		const refused = await setTicketMode({ ...unaccounted.params, mode: TicketMode.SinglePlan, approve: true });
		const switched = await setTicketMode({ ...toMultiple.params, mode: TicketMode.MultiplePlan, approve: false });

		const refusal = errorOf({ outcome: refused });
		const notice = 'error' in switched ? undefined : switched.notice;

		expect(refusal).toContain('lightsout work-order exclude-plan --implementation-removed');
		expect(notice).toContain(`lightsout work-order request-ship --name ${ticketBranch}`);
		// The old command word anywhere in either sentence is the failure this row
		// exists for, so both are checked for it rather than only for the new one.
		expect(refusal).not.toContain('lightsout ticket ');
		expect(notice).not.toContain('lightsout ticket ');
	});
});
