import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { type LightsoutConfig, PlanProgress, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { keepPublishedWorkOrderState } from '#src/workOrder/divergence/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam: the repo, its linked worktree, the ticket
// folder and every folder the keep moves or writes are real and temporary,
// because what this file is about is which checkout's folder is acted on.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: unknown; identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: unknown; url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { settings: unknown; identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { settings: unknown; url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure =>
		config['ticket-tracker'] === undefined
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: env.LINEAR_API_KEY ?? '' },
}));
// -------------------------

/** The work order's label, which is also the branch the linked worktree below stands on. */
const name = 'lo-140-multi';
const ticketRef = 'LO-140';
const planId = '002-fix';
const config: LightsoutConfig = {
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'ticket-tracker': { ...ticketTrackerConfigBlock, provider: 'linear' },
};
const env = { LINEAR_API_KEY: 'lin_key' };
const target = { settings: trackerSettingsFixture(), ticketRef };

/** The plan generation the ticket carries under the plan's own prefix, and the marker that commits it. */
const planBody = 'body of plan.md\n';
const planMarkerText = serializeAttachmentManifest({ files: [{ name: 'plan.md', content: Buffer.from(planBody, 'utf8') }] }).toString('utf8');
const planMarkerSha256 = createHash('sha256').update(planMarkerText, 'utf8').digest('hex');

const planOf = ({ publishedMarker }: { publishedMarker: string }): WorkOrderPlan => ({
	id: planId,
	title: 'Fix the thing',
	progress: PlanProgress.Ready,
	createdAt: '2026-09-01T09:00:00.000Z',
	publishedMarker,
});

const recordOf = ({ plans }: { plans: WorkOrderPlan[] }): WorkOrderState => ({
	schemaVersion: 1,
	ticketRef,
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans,
	history: [],
});

const asFileText = ({ value }: { value: unknown }) => `${JSON.stringify(value, undefined, '\t')}\n`;

/** What a folder holds, or undefined when it is not there at all. */
const folderOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

const syncStateOf = ({ workOrderFolder }: { workOrderFolder: string }) =>
	JSON.parse(readFileSync(join(workOrderFolder, 'state-sync.json'), 'utf8')) as { planMarkers: Record<string, string> };

/** The record as it stands in the primary checkout's work order folder. */
const localRecordOf = ({ workOrderFolder }: { workOrderFolder: string }): unknown => JSON.parse(readFileSync(join(workOrderFolder, 'state.json'), 'utf8'));

/**
 * A primary checkout with a linked worktree standing at the ticket's branch, a
 * ticket carrying a plan generation this machine never published or restored,
 * and that plan's folder in one of the two checkouts — or in neither.
 *
 * The keep is always run from the worktree, because that is the checkout a plan
 * command may be launched from while every plan folder lives in the primary.
 *
 * `publishedMarker` is the marker the ticket's own record claims for the plan.
 * It matches the marker the ticket actually carries unless a test hands over a
 * different one, which is the record-and-files disagreement the keep refuses.
 */
const setupWorktreeKeep = ({
	planFolderIn,
	publishedMarker = planMarkerSha256,
}: {
	planFolderIn: 'primary' | 'worktree' | 'nowhere';
	publishedMarker?: string;
}) => {
	const { cwd } = setupBranchRepo();
	const primary = realpathSync(cwd);
	const worktree = join(dirname(primary), `${basename(primary)}-worktrees`, name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	const workOrderFolder = join(primary, '.lightsout', 'work-orders', name);
	const worktreeTicketFolder = planWorkspaceFolder({ cwd: worktree, name: name });
	const published = recordOf({ plans: [planOf({ publishedMarker })] });
	const progress: string[] = [];

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'state.json'), asFileText({ value: recordOf({ plans: [planOf({ publishedMarker: 'b'.repeat(64) })] }) }));
	writeFileSync(join(workOrderFolder, 'state-sync.json'), asFileText({ value: { schemaVersion: 1, planMarkers: {} } }));

	if (planFolderIn !== 'nowhere') {
		const planFolder = join(planFolderIn === 'primary' ? join(workOrderFolder, 'plans') : worktreeTicketFolder, planId);

		mkdirSync(planFolder, { recursive: true });
		writeFileSync(join(planFolder, 'plan.md'), 'local work\n');
	}

	const bodies: Record<string, string> = {
		'state.json': asFileText({ value: published }),
		[`${planId}--plan.md`]: planBody,
		[`${planId}--plan-attachments.json`]: planMarkerText,
	};
	const titles = Object.keys(bodies);

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => {
		const title = titles[Number(url.split('/').at(-1))];

		return (title === undefined ? undefined : bodies[title]) ?? { error: `no asset at ${url}` };
	});

	return {
		primary,
		worktree,
		workOrderFolder,
		worktreeTicketFolder,
		published,
		progress,
		params: { cwd: worktree, name, config, env, target, onProgress: (message: string) => progress.push(message) },
	};
};

describe('keepPublishedWorkOrderState', () => {
	test("sets the primary checkout's plan folder aside and restores the published copy there when the keep runs in a linked worktree", async () => {
		const { params, worktree, workOrderFolder, published } = setupWorktreeKeep({ planFolderIn: 'primary' });

		const result = await keepPublishedWorkOrderState(params);

		expect(result).toStrictEqual({ record: published });
		expect(localRecordOf({ workOrderFolder })).toStrictEqual(published);
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([planId, `${planId}.local-1`]);
		expect(readFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(workOrderFolder, 'plans', `${planId}.local-1`, 'plan.md'), 'utf8')).toBe('local work\n');
		expect(syncStateOf({ workOrderFolder }).planMarkers).toStrictEqual({ [planId]: planMarkerSha256 });
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
	});

	test('sets no folder aside in the worktree, so a folder only the tree holds is left alone and the published copy lands in the primary', async () => {
		const { params, workOrderFolder, worktreeTicketFolder } = setupWorktreeKeep({ planFolderIn: 'worktree' });

		const result = await keepPublishedWorkOrderState(params);

		expect(result).toEqual({ record: expect.objectContaining({ plans: [expect.objectContaining({ publishedMarker: planMarkerSha256 })] }) });
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([planId]);
		expect(readFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'utf8')).toBe(planBody);
		expect(folderOf({ dir: worktreeTicketFolder })).toStrictEqual([planId]);
		expect(readFileSync(join(worktreeTicketFolder, planId, 'plan.md'), 'utf8')).toBe('local work\n');
	});

	test('keepPublishedWorkOrderState: the marker-mismatch refusal spells the work-order command word', async () => {
		const { params, workOrderFolder, progress } = setupWorktreeKeep({ planFolderIn: 'primary', publishedMarker: 'c'.repeat(64) });

		const result = await keepPublishedWorkOrderState(params);

		expect(result).toEqual({ error: expect.stringContaining('`lightsout work-order sync --name lo-140-multi --keep local`') });
		expect(result).toEqual({ error: expect.not.stringContaining('lightsout ticket sync') });
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([planId]);
		expect(readFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'utf8')).toBe('local work\n');
		expect(progress).toStrictEqual([]);
	});

	test('restores the published copy into the primary checkout when no checkout holds a folder to set aside', async () => {
		const { params, workOrderFolder } = setupWorktreeKeep({ planFolderIn: 'nowhere' });

		const result = await keepPublishedWorkOrderState(params);

		expect(result).toEqual({ record: expect.objectContaining({ plans: [expect.objectContaining({ publishedMarker: planMarkerSha256 })] }) });
		expect(folderOf({ dir: join(workOrderFolder, 'plans') })).toStrictEqual([planId]);
		expect(readFileSync(join(workOrderFolder, 'plans', planId, 'plan.md'), 'utf8')).toBe(planBody);
	});
});
