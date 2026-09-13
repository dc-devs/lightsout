import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, TicketEventKind, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import { addTicketPlan, updateLocalTicketRecord } from '#src/ticket/index.ts';
import type { TrackerAttachment, TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam mocked: the record, the plan folders and
// the legacy files are real files in a temporary checkout, because what this
// function promises is about which id it allocates, which bytes reach the
// record and which folder appears on disk.
const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();
/** What `setTicketAttachment` takes, named so the mock and its wrapper each read on one line. */
type AttachmentWrite = { settings: TrackerSettings; ticketId: string; title: string; content: Buffer; contentType: string };

const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined) {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		const apiKey = env[block['api-key-env']] ?? '';

		return apiKey === ''
			? { error: `the tracker API key is missing: set the \`${block['api-key-env']}\` environment variable` }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey };
	},
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };

const planOf = ({ id, progress = PlanProgress.Planning, excluded = false }: { id: string; progress?: PlanProgress; excluded?: boolean }): TicketPlan => ({
	id,
	title: id.slice(4),
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(excluded ? { exclusion: { at: '2026-01-02T00:00:00.000Z', reason: 'superseded', implementationRemoved: false } } : {}),
});

const recordOf = ({
	mode = TicketMode.SinglePlan,
	plans = [],
	shipRequestFor,
	shipped,
}: {
	mode?: TicketMode;
	plans?: TicketPlan[];
	/** The plan ids a pending ship request names. */
	shipRequestFor?: string[];
	shipped?: { at: string; planIds: string[]; mergeCommit: string };
} = {}): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'lo-140',
	branch: ticketBranch,
	mode,
	plans,
	...(shipRequestFor === undefined ? {} : { shipRequest: { planIds: shipRequestFor, requestedAt: '2026-02-01T00:00:00.000Z' } }),
	...(shipped === undefined ? {} : { shipped }),
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail: 'the ticket record was created' }],
});

const setupAddPlan = async ({
	record,
	branch = ticketBranch,
	slug = 'search-basics',
	title,
	config = { gates },
	/** Files planted at the ticket folder's top level, as a single-folder plan left them. */
	topLevelFiles = [],
	/** Directories planted at the ticket folder's top level. */
	topLevelFolders = [],
	/** The attachments the ticket carries, read only when a tracker is configured, or the failure the tracker answers with. */
	attachments = [],
}: {
	record?: TicketRecord;
	branch?: string;
	slug?: string;
	title?: string;
	config?: LightsoutConfig;
	topLevelFiles?: string[];
	topLevelFolders?: string[];
	attachments?: TrackerAttachment[] | TrackerFailure;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-add-plan-'));
	const ticketFolder = join(cwd, '.lightsout', 'plans', branch);
	const recordPath = join(ticketFolder, 'ticket.json');
	const progress: string[] = [];

	if (record !== undefined) {
		await updateLocalTicketRecord({ cwd, ticketBranch: branch, change: () => record });
	}

	mkdirSync(ticketFolder, { recursive: true });

	for (const name of topLevelFolders) {
		mkdirSync(join(ticketFolder, name), { recursive: true });
	}

	for (const name of topLevelFiles) {
		writeFileSync(join(ticketFolder, name), `# ${name}\n`);
	}

	mockGetTicketAttachments.mockResolvedValue(attachments);
	// Narrowed to the two fields a publish reads: no row here publishes, and the
	// rest of a tracker's issue shape would say nothing about this function.
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' } as TrackerTicket]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		cwd,
		ticketFolder,
		recordPath,
		progress,
		planFolderOf: ({ planId }: { planId: string }) => join(ticketFolder, planId),
		params: { cwd, ticketBranch: branch, slug, title, config, env, onProgress: (message: string) => progress.push(message) },
	};
};

/** The record as it stands on disk, which is what a later command reads. */
const recordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord;

describe('addTicketPlan', () => {
	test('creates the ticket record with the repository default mode and plan 001 when the ticket has no record', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan();

		const result = await addTicketPlan(params);

		const planFolder = planFolderOf({ planId: '001-search-basics' });

		expect(result).toEqual(
			expect.objectContaining({
				address: 'lo-140-multi/001-search-basics',
				record: expect.objectContaining({
					ticketRef: 'lo-140',
					branch: 'lo-140-multi',
					mode: 'single-plan',
					plans: [expect.objectContaining({ id: '001-search-basics', title: 'search-basics', progress: 'planning' })],
					history: [expect.objectContaining({ kind: 'plan-added' })],
				}),
			}),
		);
		expect(recordAt({ recordPath }).plans).toEqual([expect.objectContaining({ id: '001-search-basics', progress: 'planning' })]);
		expect(readdirSync(planFolder)).toStrictEqual([]);
	});

	test("seeds a new record's mode from plan.default-ticket-mode", async () => {
		const { params, recordPath } = await setupAddPlan({ config: { gates, plan: { 'default-ticket-mode': TicketMode.MultiplePlan } } });

		await addTicketPlan(params);

		expect(recordAt({ recordPath }).mode).toBe('multiple-plan');
	});

	test('allocates one more than the highest number the record holds, counting excluded plans', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({
				mode: TicketMode.MultiplePlan,
				plans: [
					planOf({ id: '001-search-basics', progress: PlanProgress.Implemented }),
					planOf({ id: '002-queue-order', progress: PlanProgress.Ready }),
					planOf({ id: '003-dropped', excluded: true }),
				],
			}),
		});

		const result = await addTicketPlan(params);

		expect(result).toEqual(expect.objectContaining({ address: 'lo-140-multi/004-fix-search' }));
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-search-basics', '002-queue-order', '003-dropped', '004-fix-search']);
		expect(existsSync(planFolderOf({ planId: '004-fix-search' }))).toBe(true);
	});

	test('withdraws a pending ship request and returns a notice naming the added plan', async () => {
		const { params, recordPath } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({
				mode: TicketMode.MultiplePlan,
				plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented }), planOf({ id: '002-queue-order', progress: PlanProgress.Ready })],
				shipRequestFor: ['001-search-basics', '002-queue-order'],
			}),
		});

		const result = await addTicketPlan(params);

		const written = recordAt({ recordPath });

		expect(result).toEqual(expect.objectContaining({ notice: expect.stringContaining('003-fix-search') }));
		expect(written.shipRequest).toBeUndefined();
		expect(written.history.slice(-2).map((event) => event.kind)).toStrictEqual(['plan-added', 'ship-request-withdrawn']);
		expect(written.history.at(-1)?.detail).toContain('003-fix-search');
	});

	test('refuses a second plan in single-plan mode and names ticket mode --set multiple-plan', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({ plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })] }),
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('ticket mode --set multiple-plan') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '002-fix-search' }))).toBe(false);
	});

	test('refuses a folder still holding legacy plan files and names ticket adopt', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({ topLevelFiles: ['plan.md'] });

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('ticket adopt') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
	});

	test('refuses stray top-level files beside an existing record and names them instead of ticket adopt', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			topLevelFiles: ['plan.md'],
			record: recordOf({ mode: TicketMode.MultiplePlan, plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })] }),
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await addTicketPlan(params);

		// A stray file beside a record predates the adoption that already happened,
		// so pointing a human at `ticket adopt` again would be the wrong repair.
		expect(result).toEqual({ error: expect.stringContaining('plan.md') });
		expect(result).toEqual({ error: expect.not.stringContaining('ticket adopt') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '002-fix-search' }))).toBe(false);
	});

	test('does not read plan folders, set-aside plan copies or ticket files as legacy files', async () => {
		const { params, recordPath, ticketFolder, planFolderOf } = await setupAddPlan({
			slug: 'ship-guard',
			topLevelFolders: ['001-a', '002-b.local-1'],
			record: recordOf({ mode: TicketMode.MultiplePlan, plans: [planOf({ id: '001-a', progress: PlanProgress.Implemented })] }),
		});

		writeFileSync(join(ticketFolder, 'ticket.json.tmp'), '{}\n');
		writeFileSync(join(ticketFolder, 'ticket-sync.json'), `${JSON.stringify({ planMarkers: {}, schemaVersion: 1 })}\n`);
		// Unparseable on purpose: a leftover lock is reclaimed at once, so the row
		// tests the listing rule rather than the lock's wait.
		writeFileSync(join(ticketFolder, 'ticket.lock'), '{');

		const result = await addTicketPlan(params);

		expect(result).toEqual(expect.objectContaining({ address: 'lo-140-multi/002-ship-guard' }));
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-a', '002-ship-guard']);
		expect(existsSync(planFolderOf({ planId: '002-ship-guard' }))).toBe(true);
	});

	test('refuses a ticket branch that carries no ticket id', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({ branch: 'feature-search' });

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.any(String) });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
	});

	test('refuses to add a plan to a ticket the record says has shipped', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({
				mode: TicketMode.MultiplePlan,
				plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })],
				shipped: { at: '2026-03-01T00:00:00.000Z', planIds: ['001-search-basics'], mergeCommit: 'c0ffee1' },
			}),
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.any(String) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '002-fix-search' }))).toBe(false);
	});

	test('refuses a slug that is not lowercase hyphen-separated words of at most 40 characters', async () => {
		const overLongSlug = 'a'.repeat(41);
		const { params, recordPath, planFolderOf } = await setupAddPlan();

		const notLowercase = await addTicketPlan({ ...params, slug: 'Search_Basics' });
		const tooLong = await addTicketPlan({ ...params, slug: overLongSlug });

		expect(notLowercase).toEqual({ error: expect.stringContaining('lowercase') });
		expect(tooLong).toEqual({ error: expect.stringContaining('40') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-Search_Basics' }))).toBe(false);
		expect(existsSync(planFolderOf({ planId: `001-${overLongSlug}` }))).toBe(false);
	});

	test('refuses a plan number above 999', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({ mode: TicketMode.MultiplePlan, plans: [planOf({ id: '999-last-one', progress: PlanProgress.Implemented })] }),
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('999') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '1000-fix-search' }))).toBe(false);
	});

	test('refuses when the ticket carries a plan published before ticket records and names ticket adopt', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			config: { gates, 'ticket-tracker': trackerBlock },
			attachments: [{ id: 'att-1', title: 'plan-attachments.json', url: 'https://assets.example.com/plan-attachments.json' }],
		});

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('ticket adopt') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test("refuses when the ticket's attachments could not be read at all", async () => {
		// Unread attachments cannot say whether a plan was published here before
		// ticket records existed, so passing over the failure is what would let a
		// new plan 001 land on top of one. Adding a plan reads the ticket twice,
		// and both reads owe that refusal.
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			config: { gates, 'ticket-tracker': trackerBlock },
			attachments: { error: 'the tracker answered 503' },
		});

		const whileReadingTheRecord = await addTicketPlan(params);
		// One clean answer lets the record read through, so the call fails on the
		// read after it: the look for a plan published before ticket records.
		mockGetTicketAttachments.mockResolvedValueOnce([]);
		const whileLookingForALegacyPlan = await addTicketPlan(params);

		expect(whileReadingTheRecord).toEqual({ error: expect.stringContaining('ticket.json') });
		expect(whileReadingTheRecord).toEqual({ error: expect.stringContaining('503') });
		expect(whileLookingForALegacyPlan).toEqual({ error: expect.not.stringContaining('ticket.json') });
		expect(whileLookingForALegacyPlan).toEqual({ error: expect.stringContaining('503') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
	});

	test('refuses a ship.ticket-pattern that reads no ticket id out of any branch, naming the key', async () => {
		// The pattern compiles but captures no `ticket` group, so no branch name
		// can be read as a ticket and a record born here would name none.
		const { params, recordPath, planFolderOf } = await setupAddPlan({ config: { gates, ship: { 'ticket-pattern': '^(lo-\\d+)' } } });

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('ship.ticket-pattern') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
	});
});
