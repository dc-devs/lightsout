import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import { keepLocalWorkOrderState } from '#src/workOrder/divergence/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam that would leave the machine. The repo,
// the worktree, the work order folder and the plan folders are all real files,
// because which checkout's copy the keep acts on is a disk read.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { settings: unknown; ticketId: string; title: string; content: Buffer; contentType: string };
type Ticket = { id: string; identifier: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: unknown; identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: unknown; identifiers: string[] }) => Promise<Ticket[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: unknown; url: string }) => Promise<string | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { settings: unknown; identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { settings: unknown; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { settings: unknown; url: string }) => mockReadTicketAsset(params),
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------
// Only the plan publish is replaced. `planWorkspaceDir` and `pathExists` stay
// real, so the checkout the republished folder is looked for in is resolved
// exactly as it is in a run.
interface PublishParams {
	cwd: string;
	name: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
	titlePrefix?: string;
}

interface PublishReport {
	ticketRef?: string;
	published: string[];
	stale: string[];
	error?: string;
	markerSha256?: string;
}

const mockPublishPlan = jest.fn<(params: PublishParams) => Promise<PublishReport>>();

jest.mock('#src/plan/index.ts', () => ({
	...jest.requireActual<typeof import('#src/plan/index.ts')>('#src/plan/index.ts'),
	publishPlan: (params: PublishParams) => mockPublishPlan(params),
}));
// -------------------------

/** The work order's label, which is also the branch the linked worktree below stands on. */
const name = 'lo-140-multi';
const ticketRef = 'LO-140';
const planId = '003-held-here';
const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const env = { LINEAR_API_KEY: 'lin_key' };
const target = { settings: trackerSettingsFixture(), ticketRef };

/** A hash of the right shape for a field the contract reads as a SHA-256, told apart by what it was made from. */
const digestOf = ({ seed }: { seed: string }) => createHash('sha256').update(seed).digest('hex');

/** The generation the ticket carries for the plan, which this machine's sidecar has never seen. */
const ticketMarker = digestOf({ seed: 'the plan as the ticket carries it' });
const republishedMarker = digestOf({ seed: 'the plan as this machine has just published it' });

const planOf = ({ publishedMarker }: { publishedMarker?: string } = {}): WorkOrderPlan => ({
	id: planId,
	title: 'Hold the plan folder in one place',
	progress: PlanProgress.Ready,
	createdAt: '2026-09-01T09:00:00.000Z',
	...(publishedMarker === undefined ? {} : { publishedMarker }),
});

const recordOf = ({ plans }: { plans: WorkOrderPlan[] }): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef,
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans,
	history: [],
});

const asFileText = ({ value }: { value: unknown }) => `${JSON.stringify(value, undefined, '\t')}\n`;

const syncStateOf = ({ workOrderFolder }: { workOrderFolder: string }) =>
	JSON.parse(readFileSync(join(workOrderFolder, 'state-sync.json'), 'utf8')) as { planMarkers: Record<string, string> };

/** The one republish this keep asked for — which checkout it was asked to publish from, and which plan. */
const publishedFrom = () => {
	const [call] = mockPublishPlan.mock.calls;

	return call === undefined ? undefined : { cwd: realpathSync(call[0].cwd), name: call[0].name, titlePrefix: call[0].titlePrefix };
};

const markersOf = ({ result }: { result: { record: WorkOrderState } | { error: string } }) =>
	'record' in result ? Object.fromEntries(result.record.plans.map((plan) => [plan.id, plan.publishedMarker])) : result;

/**
 * A primary checkout with a linked worktree standing at the ticket's branch,
 * a work order state naming one plan the ticket has republished since this machine
 * last saw it, and that plan's folder in one of the two checkouts.
 *
 * The keep is always run from the worktree, because that is the checkout a plan
 * command may be launched from while every plan folder lives in the primary.
 */
const setupWorktreeKeep = ({ planFolderIn }: { planFolderIn: 'primary' | 'worktree' }) => {
	const { cwd } = setupBranchRepo();
	const primary = realpathSync(cwd);
	const worktree = join(dirname(primary), `${basename(primary)}-worktrees`, name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	const workOrderFolder = join(primary, '.lightsout', 'work-orders', name);
	const planFolder = join(planFolderIn === 'primary' ? primary : worktree, '.lightsout', 'work-orders', name, 'plans', planId);
	const progress: string[] = [];

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'state.json'), asFileText({ value: recordOf({ plans: [planOf()] }) }));
	writeFileSync(join(workOrderFolder, 'state-sync.json'), asFileText({ value: { schemaVersion: 1, planMarkers: {} } }));
	mkdirSync(planFolder, { recursive: true });
	writeFileSync(join(planFolder, 'plan.md'), '# the plan this machine holds\n');

	mockGetTicketAttachments.mockResolvedValue([{ id: 'att-record', title: 'state.json', url: 'https://assets.example/ticket-record' }]);
	mockReadTicketAsset.mockResolvedValue(asFileText({ value: recordOf({ plans: [planOf({ publishedMarker: ticketMarker })] }) }));
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: ticketRef }]);
	mockSetTicketAttachment.mockResolvedValue(undefined);
	mockPublishPlan.mockResolvedValue({ ticketRef, published: [`${planId}--plan.md`], stale: [], markerSha256: republishedMarker });

	return {
		primary,
		worktree,
		workOrderFolder,
		progress,
		params: { cwd: worktree, name, config, env, target, onProgress: (message: string) => progress.push(message) },
	};
};

describe('keepLocalWorkOrderState', () => {
	test('republishes the divergent plan from the primary checkout when the keep runs in a linked worktree', async () => {
		const { params, primary, worktree, workOrderFolder } = setupWorktreeKeep({ planFolderIn: 'primary' });

		const result = await keepLocalWorkOrderState(params);

		// macOS resolves a temporary directory through a symlink and git answers
		// with the resolved spelling, so the two sides are compared resolved.
		const published = publishedFrom();

		expect(published).toStrictEqual({ cwd: primary, name: `${name}/${planId}`, titlePrefix: planId });
		expect(markersOf({ result })).toStrictEqual({ [planId]: republishedMarker });
		expect(syncStateOf({ workOrderFolder }).planMarkers).toStrictEqual({ [planId]: republishedMarker });
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
	});

	test("reads no plan folder out of the worktree, so a folder only the tree holds leaves the ticket's own marker in the kept record", async () => {
		const { params, progress } = setupWorktreeKeep({ planFolderIn: 'worktree' });

		const result = await keepLocalWorkOrderState(params);

		expect(mockPublishPlan).not.toHaveBeenCalled();
		expect(markersOf({ result })).toStrictEqual({ [planId]: ticketMarker });
		expect(progress.join('\n')).toContain(planId);
	});
});
