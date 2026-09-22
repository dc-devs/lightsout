import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { type LightsoutConfig, PlanProgress, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { syncWorkOrderState, WorkOrderSyncKeep } from '#src/workOrder/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam: the work order folder, the plan folders and
// every file the keep writes are real and temporary, because what this test is
// about is which bytes land on disk and which folder is moved where.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: { ticketId: string; title: string }) => Promise<TrackerFailure | undefined>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<{ id: string; identifier: string }[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined || block.provider !== 'linear') {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		return { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey: env[block['api-key-env']] ?? '' };
	},
	setTicketAttachment: (params: { ticketId: string; title: string }) => mockSetTicketAttachment(params),
}));
// -------------------------
// Where the ticket branch's own worktree sits. Mocked because the real answer
// asks git for the primary checkout, and these checkouts are temporary folders.
const mockResolveWorktreePath = jest.fn<(params: { cwd: string; branch: string }) => Promise<string>>();

jest.mock('#src/worktree/resolveWorktreePath.ts', () => ({
	resolveWorktreePath: (params: { cwd: string; branch: string }) => mockResolveWorktreePath(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const config: LightsoutConfig = { gates, 'ticket-tracker': { ...ticketTrackerConfigBlock, provider: 'linear' } };
const env = { LINEAR_API_KEY: 'lin_key' };

const name = 'lo-140-multi';
const planId = '002-fix';

/** The plan generation the ticket carries under the plan's own prefix. */
const planBody = 'body of plan.md\n';
const planMarkerText = serializeAttachmentManifest({ files: [{ name: 'plan.md', content: Buffer.from(planBody, 'utf8') }] }).toString('utf8');

const sha256Of = ({ text }: { text: string }) => createHash('sha256').update(text, 'utf8').digest('hex');

const planMarkerSha256 = sha256Of({ text: planMarkerText });

/** Object keys sorted at every depth — an independent statement of the byte form a record takes. */
const sortDeep = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map((member: unknown) => sortDeep(member));
	}

	if (value === null || typeof value !== 'object') {
		return value;
	}

	const sorted = Object.entries(value).sort(([left], [right]) => (left > right ? 1 : -1));

	return Object.fromEntries(sorted.map(([key, member]) => [key, sortDeep(member)]));
};

const canonicalText = ({ record }: { record: WorkOrderState }) => `${JSON.stringify(sortDeep(record), undefined, '\t')}\n`;

const recordOf = ({ mode = WorkOrderMode.MultiplePlan, plans = [] }: { mode?: WorkOrderMode; plans?: WorkOrderPlan[] } = {}): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode,
	plans,
	history: [],
});

const planOf = ({ publishedMarker }: { publishedMarker: string }): WorkOrderPlan => ({
	id: planId,
	title: 'Fix the thing',
	progress: PlanProgress.Ready,
	createdAt: '2026-01-01T00:00:00.000Z',
	publishedMarker,
});

/** What the ticket carries, by attachment title, and what each one reads back as. */
const trackerCarries = ({ bodies }: { bodies: Record<string, string> }) => {
	const titles = Object.keys(bodies);

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => {
		const title = titles[Number(url.split('/').at(-1))];
		const body = title === undefined ? undefined : bodies[title];

		return body ?? { error: `no asset at ${url}` };
	});
};

/** What a folder holds, or undefined when it is not there at all. */
const folderOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

const readSidecar = ({ workOrderFolder }: { workOrderFolder: string }): unknown => JSON.parse(readFileSync(join(workOrderFolder, 'state-sync.json'), 'utf8'));

/** The local record both record-only rows start from, and the bytes it sits on disk as. */
const localRecord = recordOf({ mode: WorkOrderMode.SinglePlan });
const localText = canonicalText({ record: localRecord });

/**
 * A ticket whose record is the only thing in play: a local record, a surfaced
 * published copy from an earlier divergence, and a sidecar naming the local
 * bytes as the last synced ones.
 */
const setupRecordSync = ({ published, localOnDisk = true }: { published?: WorkOrderState; localOnDisk?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-keep-published-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);

	mkdirSync(workOrderFolder, { recursive: true });

	if (localOnDisk) {
		writeFileSync(join(workOrderFolder, 'state.json'), localText);
	}

	writeFileSync(join(workOrderFolder, 'state.published.json'), '{"surfaced": true}\n');
	writeFileSync(
		join(workOrderFolder, 'state-sync.json'),
		`${JSON.stringify({ schemaVersion: 1, recordSha256: sha256Of({ text: localText }), planMarkers: {} })}\n`,
	);

	mockResolveWorktreePath.mockResolvedValue(join(cwd, 'no-such-worktree'));
	trackerCarries({ bodies: published === undefined ? {} : { 'state.json': canonicalText({ record: published }) } });

	return { cwd, workOrderFolder };
};

/**
 * A ticket whose published record names a plan marker this machine never
 * published or restored — the divergent-plan case — with the plan's folder held
 * locally, and optionally in the ticket branch's worktree as well.
 */
const setupDivergentPlan = ({
	recordedMarker = planMarkerSha256,
	asideCopy = false,
	worktreeHoldsPlan = false,
	planFilesOnTicket = true,
}: {
	recordedMarker?: string;
	asideCopy?: boolean;
	worktreeHoldsPlan?: boolean;
	/** False leaves the plan's marker on the ticket with the file it commits missing, so the restore cannot succeed. */
	planFilesOnTicket?: boolean;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-keep-published-'));
	const worktree = mkdtempSync(join(tmpdir(), 'lightsout-keep-published-tree-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const worktreeTicketFolder = planWorkspaceFolder({ cwd: worktree, name: name });
	const published = recordOf({ plans: [planOf({ publishedMarker: recordedMarker })] });
	const local = recordOf({ plans: [planOf({ publishedMarker: 'b'.repeat(64) })] });

	mkdirSync(join(workOrderFolder, 'plans', planId), { recursive: true });
	writeFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'local work\n');
	writeFileSync(join(workOrderFolder, 'state.json'), canonicalText({ record: local }));
	writeFileSync(join(workOrderFolder, 'state-sync.json'), `${JSON.stringify({ schemaVersion: 1, planMarkers: {} })}\n`);

	if (asideCopy) {
		mkdirSync(join(workOrderFolder, 'plans', `${planId}.local-1`), { recursive: true });
		writeFileSync(join(workOrderFolder, 'plans', `${planId}.local-1`, 'plan.md'), 'earlier aside\n');
	}

	if (worktreeHoldsPlan) {
		mkdirSync(join(worktreeTicketFolder, planId), { recursive: true });
		writeFileSync(join(worktreeTicketFolder, planId, 'plan.md'), 'worktree work\n');
	}

	mockResolveWorktreePath.mockResolvedValue(worktree);
	trackerCarries({
		bodies: {
			'state.json': canonicalText({ record: published }),
			...(planFilesOnTicket ? { [`${planId}--plan.md`]: planBody } : {}),
			[`${planId}--plan-attachments.json`]: planMarkerText,
		},
	});

	return { cwd, workOrderFolder, worktreeTicketFolder, published };
};

/**
 * The same divergent-plan case, laid out the way the work order folder now files it:
 * the work order's state files at `.lightsout/work-orders/<branch>/`, and every plan of
 * that ticket one level down in its `plans/` folder.
 */
const setupDivergentPlanInTicketFolder = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-keep-published-tickets-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const plansFolder = join(workOrderFolder, 'plans');
	const published = recordOf({ plans: [planOf({ publishedMarker: planMarkerSha256 })] });
	const local = recordOf({ plans: [planOf({ publishedMarker: 'b'.repeat(64) })] });

	mkdirSync(join(plansFolder, planId), { recursive: true });
	writeFileSync(join(plansFolder, planId, 'plan.md'), 'local work\n');
	writeFileSync(join(workOrderFolder, 'state.json'), canonicalText({ record: local }));
	writeFileSync(join(workOrderFolder, 'state-sync.json'), `${JSON.stringify({ schemaVersion: 1, planMarkers: {} })}\n`);

	mockResolveWorktreePath.mockResolvedValue(join(cwd, 'no-such-worktree'));
	trackerCarries({
		bodies: {
			'state.json': canonicalText({ record: published }),
			[`${planId}--plan.md`]: planBody,
			[`${planId}--plan-attachments.json`]: planMarkerText,
		},
	});

	return { cwd, workOrderFolder, plansFolder, published };
};

describe('syncWorkOrderState', () => {
	test('syncWorkOrderState: keeping the published copy writes it locally, records its hash and removes state.published.json', async () => {
		const published = recordOf();
		const { cwd, workOrderFolder } = setupRecordSync({ published });

		const result = await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		expect(result).toStrictEqual({ record: published });
		expect(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')).toBe(canonicalText({ record: published }));
		expect(readSidecar({ workOrderFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: sha256Of({ text: canonicalText({ record: published }) }),
			planMarkers: {},
		});
		expect(folderOf({ dir: workOrderFolder })).toStrictEqual(['state-sync.json', 'state.json']);
	});

	test("syncWorkOrderState: keeping the published copy moves a divergent plan's folder aside to the next free .local-<n> and restores the published plan", async () => {
		const { cwd, workOrderFolder, published } = setupDivergentPlan({ asideCopy: true });

		const result = await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		expect(result).toStrictEqual({ record: published });
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([planId, `${planId}.local-1`, `${planId}.local-2`]);
		expect(readFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(workOrderFolder, 'plans', `${planId}.local-2`, 'plan.md'), 'utf8')).toBe('local work\n');
		expect(readFileSync(join(workOrderFolder, 'plans', `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('earlier aside\n');
		expect(readSidecar({ workOrderFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: sha256Of({ text: canonicalText({ record: published }) }),
			planMarkers: { [planId]: planMarkerSha256 },
		});
	});

	test("syncWorkOrderState: keeping the published copy refuses, moving nothing, when the ticket's plan files and record disagree", async () => {
		const { cwd, workOrderFolder } = setupDivergentPlan({ recordedMarker: 'a'.repeat(64) });

		const result = await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		expect(result).toEqual({ error: expect.stringContaining(planId) });
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([planId]);
		expect(readFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'utf8')).toBe('local work\n');
	});

	test("syncWorkOrderState: keeping the published copy acts on the primary checkout's copy and leaves a worktree's own alone", async () => {
		const { cwd, workOrderFolder, worktreeTicketFolder } = setupDivergentPlan({ worktreeHoldsPlan: true });

		await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		// a plan folder lives in the primary checkout, so that is the copy the sync
		// acts on: the divergent one is set aside and the published one restored
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([planId, `${planId}.local-1`]);
		expect(readFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(workOrderFolder, 'plans', `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('local work\n');
		// a directory a worktree happens to hold is nobody's plan folder, so it is
		// neither read nor moved
		expect(folderOf({ dir: worktreeTicketFolder })).toStrictEqual([planId]);
		expect(readFileSync(join(worktreeTicketFolder, planId, 'plan.md'), 'utf8')).toBe('worktree work\n');
	});

	test('syncWorkOrderState: keeping the published copy takes it whole when this machine holds no record of its own', async () => {
		const published = recordOf();
		const { cwd, workOrderFolder } = setupRecordSync({ published, localOnDisk: false });

		const result = await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		expect(result).toStrictEqual({ record: published });
		expect(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')).toBe(canonicalText({ record: published }));
		expect(readSidecar({ workOrderFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: sha256Of({ text: canonicalText({ record: published }) }),
			planMarkers: {},
		});
	});

	test('syncWorkOrderState: keeping the published copy answers the restore failure when the ticket carries the plan marker but not its files', async () => {
		const { cwd, workOrderFolder } = setupDivergentPlan({ planFilesOnTicket: false });

		const result = await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		expect(result).toStrictEqual({ error: expect.stringContaining('plan.md') });
		// The record was kept before the plan was reached, and the local folder was
		// set aside rather than removed, so nothing the machine held is gone.
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([`${planId}.local-1`]);
		expect(readFileSync(join(workOrderFolder, 'plans', `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('local work\n');
	});

	test('syncWorkOrderState: keeping the published copy refuses when the ticket carries no state.json', async () => {
		const { cwd, workOrderFolder } = setupRecordSync();

		const result = await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		// The sentence has to name the ticket that carries nothing and the file that
		// is missing, or 'keep published' reads as having failed for no reason.
		expect(result).toEqual({ error: expect.stringContaining('state.json') });
		expect(result).toEqual({ error: expect.stringMatching(/lo-140/iu) });
		expect(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')).toBe(localText);
		expect(readSidecar({ workOrderFolder })).toStrictEqual({ schemaVersion: 1, recordSha256: sha256Of({ text: localText }), planMarkers: {} });
	});

	test("syncWorkOrderState: a kept-published sync sets the local plan aside inside the ticket's plans folder", async () => {
		const { cwd, workOrderFolder, plansFolder, published } = setupDivergentPlanInTicketFolder();

		const result = await syncWorkOrderState({ cwd, name, config, env, keep: WorkOrderSyncKeep.Published });

		expect(result).toStrictEqual({ record: published });
		// the set-aside copy and the restored plan are siblings inside plans/,
		// which is the only folder the numbering ever looks at
		expect(folderOf({ dir: plansFolder })).toStrictEqual([planId, `${planId}.local-1`]);
		expect(readFileSync(join(plansFolder, planId, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(plansFolder, `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('local work\n');
		// the ticket's own record files sit one level up, so no copy of a plan can
		// land beside them and none of them is an entry the set-aside considered
		expect(folderOf({ dir: workOrderFolder })).toStrictEqual(['plans', 'state-sync.json', 'state.json']);
	});
});
