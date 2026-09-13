import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { type LightsoutConfig, PlanProgress, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import { syncTicketRecord, TicketSyncKeep } from '#src/ticket/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam: the ticket folder, the plan folders and
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

const ticketBranch = 'lo-140-multi';
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

const canonicalText = ({ record }: { record: TicketRecord }) => `${JSON.stringify(sortDeep(record), undefined, '\t')}\n`;

const recordOf = ({ mode = TicketMode.MultiplePlan, plans = [] }: { mode?: TicketMode; plans?: TicketPlan[] } = {}): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode,
	plans,
	history: [],
});

const planOf = ({ publishedMarker }: { publishedMarker: string }): TicketPlan => ({
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

const readSidecar = ({ ticketFolder }: { ticketFolder: string }): unknown => JSON.parse(readFileSync(join(ticketFolder, 'ticket-sync.json'), 'utf8'));

/** The local record both record-only rows start from, and the bytes it sits on disk as. */
const localRecord = recordOf({ mode: TicketMode.SinglePlan });
const localText = canonicalText({ record: localRecord });

/**
 * A ticket whose record is the only thing in play: a local record, a surfaced
 * published copy from an earlier divergence, and a sidecar naming the local
 * bytes as the last synced ones.
 */
const setupRecordSync = ({ published, localOnDisk = true }: { published?: TicketRecord; localOnDisk?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-keep-published-'));
	const ticketFolder = join(cwd, '.lightsout', 'plans', ticketBranch);

	mkdirSync(ticketFolder, { recursive: true });

	if (localOnDisk) {
		writeFileSync(join(ticketFolder, 'ticket.json'), localText);
	}

	writeFileSync(join(ticketFolder, 'ticket.published.json'), '{"surfaced": true}\n');
	writeFileSync(
		join(ticketFolder, 'ticket-sync.json'),
		`${JSON.stringify({ schemaVersion: 1, recordSha256: sha256Of({ text: localText }), planMarkers: {} })}\n`,
	);

	mockResolveWorktreePath.mockResolvedValue(join(cwd, 'no-such-worktree'));
	trackerCarries({ bodies: published === undefined ? {} : { 'ticket.json': canonicalText({ record: published }) } });

	return { cwd, ticketFolder };
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
	const ticketFolder = join(cwd, '.lightsout', 'plans', ticketBranch);
	const worktreeTicketFolder = join(worktree, '.lightsout', 'plans', ticketBranch);
	const published = recordOf({ plans: [planOf({ publishedMarker: recordedMarker })] });
	const local = recordOf({ plans: [planOf({ publishedMarker: 'b'.repeat(64) })] });

	mkdirSync(join(ticketFolder, planId), { recursive: true });
	writeFileSync(join(ticketFolder, planId, 'plan.md'), 'local work\n');
	writeFileSync(join(ticketFolder, 'ticket.json'), canonicalText({ record: local }));
	writeFileSync(join(ticketFolder, 'ticket-sync.json'), `${JSON.stringify({ schemaVersion: 1, planMarkers: {} })}\n`);

	if (asideCopy) {
		mkdirSync(join(ticketFolder, `${planId}.local-1`), { recursive: true });
		writeFileSync(join(ticketFolder, `${planId}.local-1`, 'plan.md'), 'earlier aside\n');
	}

	if (worktreeHoldsPlan) {
		mkdirSync(join(worktreeTicketFolder, planId), { recursive: true });
		writeFileSync(join(worktreeTicketFolder, planId, 'plan.md'), 'worktree work\n');
	}

	mockResolveWorktreePath.mockResolvedValue(worktree);
	trackerCarries({
		bodies: {
			'ticket.json': canonicalText({ record: published }),
			...(planFilesOnTicket ? { [`${planId}--plan.md`]: planBody } : {}),
			[`${planId}--plan-attachments.json`]: planMarkerText,
		},
	});

	return { cwd, ticketFolder, worktreeTicketFolder, published };
};

describe('syncTicketRecord', () => {
	test('syncTicketRecord: keeping the published copy writes it locally, records its hash and removes ticket.published.json', async () => {
		const published = recordOf();
		const { cwd, ticketFolder } = setupRecordSync({ published });

		const result = await syncTicketRecord({ cwd, ticketBranch, config, env, keep: TicketSyncKeep.Published });

		expect(result).toStrictEqual({ record: published });
		expect(readFileSync(join(ticketFolder, 'ticket.json'), 'utf8')).toBe(canonicalText({ record: published }));
		expect(readSidecar({ ticketFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: sha256Of({ text: canonicalText({ record: published }) }),
			planMarkers: {},
		});
		expect(folderOf({ dir: ticketFolder })).toStrictEqual(['ticket-sync.json', 'ticket.json']);
	});

	test("syncTicketRecord: keeping the published copy moves a divergent plan's folder aside to the next free .local-<n> and restores the published plan", async () => {
		const { cwd, ticketFolder, published } = setupDivergentPlan({ asideCopy: true });

		const result = await syncTicketRecord({ cwd, ticketBranch, config, env, keep: TicketSyncKeep.Published });

		expect(result).toStrictEqual({ record: published });
		expect(folderOf({ dir: ticketFolder })).toStrictEqual([planId, `${planId}.local-1`, `${planId}.local-2`, 'ticket-sync.json', 'ticket.json']);
		expect(readFileSync(join(ticketFolder, planId, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(ticketFolder, `${planId}.local-2`, 'plan.md'), 'utf8')).toBe('local work\n');
		expect(readFileSync(join(ticketFolder, `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('earlier aside\n');
		expect(readSidecar({ ticketFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: sha256Of({ text: canonicalText({ record: published }) }),
			planMarkers: { [planId]: planMarkerSha256 },
		});
	});

	test("syncTicketRecord: keeping the published copy refuses, moving nothing, when the ticket's plan files and record disagree", async () => {
		const { cwd, ticketFolder } = setupDivergentPlan({ recordedMarker: 'a'.repeat(64) });

		const result = await syncTicketRecord({ cwd, ticketBranch, config, env, keep: TicketSyncKeep.Published });

		expect(result).toEqual({ error: expect.stringContaining(planId) });
		expect(folderOf({ dir: ticketFolder })).toStrictEqual([planId, 'ticket-sync.json', 'ticket.json']);
		expect(readFileSync(join(ticketFolder, planId, 'plan.md'), 'utf8')).toBe('local work\n');
	});

	test("syncTicketRecord: keeping the published copy acts on the plan's working copy and sets aside every local copy", async () => {
		const { cwd, ticketFolder, worktreeTicketFolder } = setupDivergentPlan({ worktreeHoldsPlan: true });

		await syncTicketRecord({ cwd, ticketBranch, config, env, keep: TicketSyncKeep.Published });

		expect(folderOf({ dir: worktreeTicketFolder })).toStrictEqual([planId, `${planId}.local-1`]);
		expect(readFileSync(join(worktreeTicketFolder, planId, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(worktreeTicketFolder, `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('worktree work\n');
		expect(folderOf({ dir: ticketFolder })).toStrictEqual([`${planId}.local-1`, 'ticket-sync.json', 'ticket.json']);
		expect(readFileSync(join(ticketFolder, `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('local work\n');
	});

	test('syncTicketRecord: keeping the published copy takes it whole when this machine holds no record of its own', async () => {
		const published = recordOf();
		const { cwd, ticketFolder } = setupRecordSync({ published, localOnDisk: false });

		const result = await syncTicketRecord({ cwd, ticketBranch, config, env, keep: TicketSyncKeep.Published });

		expect(result).toStrictEqual({ record: published });
		expect(readFileSync(join(ticketFolder, 'ticket.json'), 'utf8')).toBe(canonicalText({ record: published }));
		expect(readSidecar({ ticketFolder })).toStrictEqual({
			schemaVersion: 1,
			recordSha256: sha256Of({ text: canonicalText({ record: published }) }),
			planMarkers: {},
		});
	});

	test('syncTicketRecord: keeping the published copy answers the restore failure when the ticket carries the plan marker but not its files', async () => {
		const { cwd, ticketFolder } = setupDivergentPlan({ planFilesOnTicket: false });

		const result = await syncTicketRecord({ cwd, ticketBranch, config, env, keep: TicketSyncKeep.Published });

		expect(result).toStrictEqual({ error: expect.stringContaining('plan.md') });
		// The record was kept before the plan was reached, and the local folder was
		// set aside rather than removed, so nothing the machine held is gone.
		expect(folderOf({ dir: ticketFolder })).toStrictEqual([`${planId}.local-1`, 'ticket-sync.json', 'ticket.json']);
		expect(readFileSync(join(ticketFolder, `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('local work\n');
	});

	test('syncTicketRecord: keeping the published copy refuses when the ticket carries no ticket.json', async () => {
		const { cwd, ticketFolder } = setupRecordSync();

		const result = await syncTicketRecord({ cwd, ticketBranch, config, env, keep: TicketSyncKeep.Published });

		// The sentence has to name the ticket that carries nothing and the file that
		// is missing, or 'keep published' reads as having failed for no reason.
		expect(result).toEqual({ error: expect.stringContaining('ticket.json') });
		expect(result).toEqual({ error: expect.stringMatching(/lo-140/iu) });
		expect(readFileSync(join(ticketFolder, 'ticket.json'), 'utf8')).toBe(localText);
		expect(readSidecar({ ticketFolder })).toStrictEqual({ schemaVersion: 1, recordSha256: sha256Of({ text: localText }), planMarkers: {} });
	});
});
