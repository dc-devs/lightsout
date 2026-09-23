import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, WorkOrderEventKind, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerAttachment, TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { addWorkOrderPlan, updateLocalWorkOrderState } from '#src/workOrder/index.ts';

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

/** The work order's label, which is also the branch every record below names. */
const name = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const env = { LINEAR_API_KEY: 'lin_key' };

const planOf = ({ id, progress = PlanProgress.Planning, excluded = false }: { id: string; progress?: PlanProgress; excluded?: boolean }): WorkOrderPlan => ({
	id,
	title: id.slice(4),
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(excluded ? { exclusion: { at: '2026-01-02T00:00:00.000Z', reason: 'superseded', implementationRemoved: false } } : {}),
});

const recordOf = ({
	label = name,
	ticketRef = 'lo-140',
	mode = WorkOrderMode.SinglePlan,
	plans = [],
	shipRequestFor,
	shipped,
}: {
	/** The work order's label, which is also its folder. Defaults to the one every row below uses. */
	label?: string;
	/** The tracker reference the record carries, or null for a work order named from words alone. */
	ticketRef?: string | null;
	mode?: WorkOrderMode;
	plans?: WorkOrderPlan[];
	/** The plan ids a pending ship request names. */
	shipRequestFor?: string[];
	shipped?: { at: string; planIds: string[]; mergeCommit: string };
} = {}): WorkOrderState => ({
	schemaVersion: 1,
	name: label,
	...(ticketRef === null ? {} : { ticketRef }),
	branch: label,
	mode,
	plans,
	...(shipRequestFor === undefined ? {} : { shipRequest: { planIds: shipRequestFor, requestedAt: '2026-02-01T00:00:00.000Z' } }),
	...(shipped === undefined ? {} : { shipped }),
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'the work order state was created' }],
});

const setupAddPlan = async ({
	record,
	branch = name,
	slug = 'search-basics',
	config = { gates },
	/** Files planted at the work order folder's top level, as a single-folder plan left them. */
	topLevelFiles = [],
	/** Directories planted at the work order folder's top level. */
	topLevelFolders = [],
}: {
	record?: WorkOrderState;
	branch?: string;
	slug?: string;
	config?: LightsoutConfig;
	topLevelFiles?: string[];
	topLevelFolders?: string[];
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-add-plan-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', branch);
	const recordPath = join(workOrderFolder, 'state.json');
	const progress: string[] = [];

	if (record !== undefined) {
		await updateLocalWorkOrderState({ cwd, name: branch, change: () => record });
	}

	mkdirSync(join(workOrderFolder, 'plans'), { recursive: true });

	for (const name of topLevelFolders) {
		mkdirSync(join(workOrderFolder, 'plans', name), { recursive: true });
	}

	for (const name of topLevelFiles) {
		writeFileSync(join(workOrderFolder, 'plans', name), `# ${name}\n`);
	}

	mockGetTicketAttachments.mockResolvedValue([]);
	// Narrowed to the two fields a publish reads: no row here publishes, and the
	// rest of a tracker's issue shape would say nothing about this function.
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' } as TrackerTicket]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		cwd,
		workOrderFolder,
		recordPath,
		planFolderOf: ({ planId }: { planId: string }) => join(workOrderFolder, 'plans', planId),
		params: { cwd, name: branch, slug, config, env, onProgress: (message: string) => progress.push(message) },
	};
};

/** The record as it stands on disk, which is what a later command reads. */
const recordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState;

describe('addWorkOrderPlan', () => {
	test('allocates plan 001 and its empty folder to a record that holds no plans yet', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({ record: recordOf() });

		const result = await addWorkOrderPlan(params);

		const planFolder = planFolderOf({ planId: '001-search-basics' });

		expect(result).toEqual(
			expect.objectContaining({
				address: 'lo-140-multi/001-search-basics',
				record: expect.objectContaining({
					ticketRef: 'lo-140',
					branch: 'lo-140-multi',
					mode: 'single-plan',
					plans: [expect.objectContaining({ id: '001-search-basics', title: 'search-basics', progress: 'planning' })],
					history: [expect.objectContaining({ kind: 'plan-added' }), expect.objectContaining({ kind: 'plan-added' })],
				}),
			}),
		);
		expect(recordAt({ recordPath }).plans).toEqual([expect.objectContaining({ id: '001-search-basics', progress: 'planning' })]);
		expect(readdirSync(planFolder)).toStrictEqual([]);
	});

	test('allocates one more than the highest number the record holds, counting excluded plans', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({
				mode: WorkOrderMode.MultiplePlan,
				plans: [
					planOf({ id: '001-search-basics', progress: PlanProgress.Implemented }),
					planOf({ id: '002-queue-order', progress: PlanProgress.Ready }),
					planOf({ id: '003-dropped', excluded: true }),
				],
			}),
		});

		const result = await addWorkOrderPlan(params);

		expect(result).toEqual(expect.objectContaining({ address: 'lo-140-multi/004-fix-search' }));
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-search-basics', '002-queue-order', '003-dropped', '004-fix-search']);
		expect(existsSync(planFolderOf({ planId: '004-fix-search' }))).toBe(true);
	});

	test('withdraws a pending ship request and returns a notice naming the added plan', async () => {
		const { params, recordPath } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({
				mode: WorkOrderMode.MultiplePlan,
				plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented }), planOf({ id: '002-queue-order', progress: PlanProgress.Ready })],
				shipRequestFor: ['001-search-basics', '002-queue-order'],
			}),
		});

		const result = await addWorkOrderPlan(params);

		const written = recordAt({ recordPath });

		expect(result).toEqual(expect.objectContaining({ notice: expect.stringContaining('003-fix-search') }));
		expect(written.shipRequest).toBeUndefined();
		expect(written.history.slice(-2).map((event) => event.kind)).toStrictEqual(['plan-added', 'ship-request-withdrawn']);
		expect(written.history.at(-1)?.detail).toContain('003-fix-search');
	});

	test('refuses a second plan in single-plan mode and names work-order mode --set multiple-plan', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({ plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })] }),
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await addWorkOrderPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('work-order mode --set multiple-plan') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '002-fix-search' }))).toBe(false);
	});

	test('does not read plan folders, set-aside plan copies or ticket files as legacy files', async () => {
		const { params, recordPath, workOrderFolder, planFolderOf } = await setupAddPlan({
			slug: 'ship-guard',
			topLevelFolders: ['001-a', '002-b.local-1'],
			record: recordOf({ mode: WorkOrderMode.MultiplePlan, plans: [planOf({ id: '001-a', progress: PlanProgress.Implemented })] }),
		});

		writeFileSync(join(workOrderFolder, 'state.json.tmp'), '{}\n');
		writeFileSync(join(workOrderFolder, 'state-sync.json'), `${JSON.stringify({ planMarkers: {}, schemaVersion: 1 })}\n`);
		// Unparseable on purpose: a leftover lock is reclaimed at once, so the row
		// tests the listing rule rather than the lock's wait.
		writeFileSync(join(workOrderFolder, 'state.lock'), '{');

		const result = await addWorkOrderPlan(params);

		expect(result).toEqual(expect.objectContaining({ address: 'lo-140-multi/002-ship-guard' }));
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-a', '002-ship-guard']);
		expect(existsSync(planFolderOf({ planId: '002-ship-guard' }))).toBe(true);
	});

	test('refuses to add a plan to a ticket the record says has shipped', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({
				mode: WorkOrderMode.MultiplePlan,
				plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })],
				shipped: { at: '2026-03-01T00:00:00.000Z', planIds: ['001-search-basics'], mergeCommit: 'c0ffee1' },
			}),
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await addWorkOrderPlan(params);

		// the sentence names the work order the record itself claims, and the
		// commit it shipped as, so a human can see which history refused them
		expect(result).toEqual({ error: expect.stringContaining(`work order ${name} shipped as c0ffee1`) });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '002-fix-search' }))).toBe(false);
	});

	test('refuses a slug that is not lowercase hyphen-separated words of at most 40 characters', async () => {
		const overLongSlug = 'a'.repeat(41);
		const { params, recordPath, planFolderOf } = await setupAddPlan({ record: recordOf() });
		const before = readFileSync(recordPath, 'utf8');

		const notLowercase = await addWorkOrderPlan({ ...params, slug: 'Search_Basics' });
		const tooLong = await addWorkOrderPlan({ ...params, slug: overLongSlug });

		expect(notLowercase).toEqual({ error: expect.stringContaining('lowercase') });
		expect(tooLong).toEqual({ error: expect.stringContaining('40') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '001-Search_Basics' }))).toBe(false);
		expect(existsSync(planFolderOf({ planId: `001-${overLongSlug}` }))).toBe(false);
	});

	test('refuses a plan number above 999', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({ mode: WorkOrderMode.MultiplePlan, plans: [planOf({ id: '999-last-one', progress: PlanProgress.Implemented })] }),
		});
		const before = readFileSync(recordPath, 'utf8');

		const result = await addWorkOrderPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('999') });
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
		expect(existsSync(planFolderOf({ planId: '1000-fix-search' }))).toBe(false);
	});

	test('adds the plan under a ship.ticket-pattern that reads no ticket id out of any branch', async () => {
		// The pattern compiles but captures no `ticket` group, so no branch name
		// can be read as a ticket — which changes nothing here: the record already
		// says which ticket it belongs to, and adding a plan never asks a pattern.
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			config: { gates, ship: { 'ticket-pattern': '^(lo-\\d+)' } },
			record: recordOf({ ticketRef: null }),
		});

		const result = await addWorkOrderPlan(params);

		expect(result).toEqual(expect.objectContaining({ address: 'lo-140-multi/001-search-basics' }));
		expect(Object.keys(recordAt({ recordPath }))).not.toContain('ticketRef');
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(true);
	});

	test('every addWorkOrderPlan sentence that names a command spells the work-order command word', async () => {
		const singlePlan = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({ plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })] }),
		});
		const withdrawing = await setupAddPlan({
			slug: 'fix-search',
			record: recordOf({
				mode: WorkOrderMode.MultiplePlan,
				plans: [planOf({ id: '001-search-basics', progress: PlanProgress.Implemented })],
				shipRequestFor: ['001-search-basics'],
			}),
		});

		const modeRefusal = await addWorkOrderPlan(singlePlan.params);
		const withdrawal = await addWorkOrderPlan(withdrawing.params);

		// The forbidden span keeps its trailing space, so `lightsout ticket-state`
		// — the one command that genuinely names the tracker — never trips this row.
		expect(modeRefusal).toEqual({ error: expect.stringContaining('lightsout work-order mode --set multiple-plan') });
		expect(modeRefusal).toEqual({ error: expect.not.stringContaining('lightsout ticket ') });
		expect(withdrawal).toEqual(expect.objectContaining({ notice: expect.stringContaining('lightsout work-order request-ship') }));
		expect(withdrawal).toEqual(expect.objectContaining({ notice: expect.not.stringContaining('lightsout ticket ') }));
	});

	test('adds a first plan to a tracker-free work order', async () => {
		const { params, recordPath, planFolderOf } = await setupAddPlan({
			branch: 'feature-search',
			record: recordOf({ label: 'feature-search', ticketRef: null }),
		});

		const result = await addWorkOrderPlan(params);

		// The label carries no ticket id, so the record names the work order and
		// the branch it implements on, and claims no tracker reference at all.
		const written = recordAt({ recordPath });

		expect(result).toEqual(
			expect.objectContaining({
				address: 'feature-search/001-search-basics',
				record: expect.objectContaining({
					name: 'feature-search',
					branch: 'feature-search',
					plans: [expect.objectContaining({ id: '001-search-basics', title: 'search-basics', progress: 'planning' })],
				}),
			}),
		);
		expect(written).toEqual(expect.objectContaining({ name: 'feature-search', branch: 'feature-search' }));
		expect(Object.keys(written)).not.toContain('ticketRef');
		expect(readdirSync(planFolderOf({ planId: '001-search-basics' }))).toStrictEqual([]);
	});

	test('adds a plan beside loose files in the plans folder', async () => {
		const { params, recordPath, workOrderFolder, planFolderOf } = await setupAddPlan({ record: recordOf(), topLevelFiles: ['facts.json', 'plan.md'] });

		const result = await addWorkOrderPlan(params);

		// Loose files are no longer a plan waiting to be adopted, so they neither
		// refuse the add nor move: the new plan's folder is made empty beside them.
		expect(result).toEqual(expect.objectContaining({ address: 'lo-140-multi/001-search-basics' }));
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-search-basics']);
		expect(readdirSync(planFolderOf({ planId: '001-search-basics' }))).toStrictEqual([]);
		expect(existsSync(join(workOrderFolder, 'plans', 'plan.md'))).toBe(true);
		expect(existsSync(join(workOrderFolder, 'plans', 'facts.json'))).toBe(true);
	});

	test('addWorkOrderPlan: refuses a label no work order holds and points at work-order new', async () => {
		const { params, recordPath, workOrderFolder, planFolderOf } = await setupAddPlan();

		const result = await addWorkOrderPlan(params);

		// Adding a plan no longer creates the work order: a label no record
		// answers to is a typo, and the sentence names the one command that
		// writes a name.
		expect(result).toEqual({ error: expect.stringContaining('lightsout work-order new') });
		expect(result).toEqual({ error: expect.stringContaining(name) });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
		expect(readdirSync(join(workOrderFolder, 'plans'))).toStrictEqual([]);
	});
});
