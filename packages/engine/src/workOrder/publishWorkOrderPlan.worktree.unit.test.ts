import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { publishWorkOrderPlan } from '#src/workOrder/publishWorkOrderPlan.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam, standing in for the ticket as a map of
// title to text, so what landed can be read back without a network. The
// repository, its linked worktree and every plan file are real on disk, because
// the claim is about which checkout the notes are read from.
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

		return { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: env[block['api-key-env']] ?? '' };
	},
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

const name = 'lo-140-multi-plan';
const planId = '001-ship-guard';
const address = `${name}/${planId}`;
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };
const planBody = '# The ship guard\n';
const decisionsBody = '[{"id":1}]';
const primaryNotesBody = '# Shaped in the main checkout\n';
const worktreeNotesBody = '# Shaped inside the tree\n';

const planTitles = [`${planId}--plan.md`, `${planId}--decisions.json`, `${planId}--plan-attachments.json`];
const brainstormTitles = [`${planId}--brainstorm-notes.md`, `${planId}--brainstorm-attachments.json`];

/** A record the contract accepts, holding this ticket's one plan. */
const ticketRecordOf = (): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans: [{ id: planId, title: 'The ship guard', progress: PlanProgress.Planning, createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: `added plan ${planId}` }],
});

/**
 * A real primary checkout with a linked worktree standing on the ticket's own
 * branch, the plan folder held by the primary, and the publish run from inside
 * the tree — the shape a plan command takes once `plan.worktree` moves the
 * session into a tree.
 *
 * `notesIn` says which checkout holds `brainstorm-notes.md`, which is the whole
 * question: the tree's copy is one no command may read, because the tree is
 * removed when its work ships.
 */
const setupPublishFromWorktree = ({ notesIn = 'primary' }: { notesIn?: 'primary' | 'worktree' } = {}) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd, stdio: 'ignore' });

	const primaryTicketFolder = join(realpathSync(cwd), '.lightsout', 'work-orders', name);
	const primaryPlanFolder = join(primaryTicketFolder, 'plans', planId);
	const worktreePlanFolder = join(worktree, '.lightsout', 'work-orders', name, 'plans', planId);
	const assets = new Map<string, string>();
	const progressLines: string[] = [];

	mkdirSync(primaryPlanFolder, { recursive: true });
	writeFileSync(join(primaryPlanFolder, 'plan.md'), planBody);
	writeFileSync(join(primaryPlanFolder, 'decisions.json'), decisionsBody);
	writeFileSync(join(primaryTicketFolder, 'state.json'), JSON.stringify(ticketRecordOf()));

	if (notesIn === 'primary') {
		writeFileSync(join(primaryPlanFolder, 'brainstorm-notes.md'), primaryNotesBody);
	} else {
		mkdirSync(worktreePlanFolder, { recursive: true });
		writeFileSync(join(worktreePlanFolder, 'brainstorm-notes.md'), worktreeNotesBody);
	}

	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' } as TrackerTicket]);
	mockGetTicketAttachments.mockImplementation(async () =>
		[...assets.keys()].map((title, index) => ({ id: `att-${index}`, title, url: `https://tracker.example/${encodeURIComponent(title)}` })),
	);
	mockReadTicketAsset.mockImplementation(async ({ url }) => {
		const title = decodeURIComponent(url.split('/').at(-1) ?? '');

		return assets.get(title) ?? { error: `no asset titled ${title}` };
	});
	mockSetTicketAttachment.mockImplementation(async ({ title, content }) => {
		assets.set(title, content.toString('utf8'));

		return undefined;
	});

	return {
		assets,
		worktree,
		params: {
			cwd: worktree,
			address,
			config: { gates, 'ticket-tracker': trackerBlock },
			env,
			onProgress: (message: string) => progressLines.push(message),
		},
	};
};

/** Every attachment title the tracker was asked to write, in the order it was asked. */
const attachedTitles = () => mockSetTicketAttachment.mock.calls.map(([call]) => call.title);

describe('publishWorkOrderPlan', () => {
	test("publishes the primary checkout's brainstorm notes when the publish is run from a linked worktree", async () => {
		const { params, assets, worktree } = setupPublishFromWorktree();

		const report = await publishWorkOrderPlan(params);

		expect({
			published: report.published,
			error: report.error,
			recordError: report.recordError,
			attached: attachedTitles(),
			notesOnTheTicket: assets.get(`${planId}--brainstorm-notes.md`),
			planDataInsideTheWorktree: existsSync(join(worktree, '.lightsout')),
		}).toStrictEqual({
			published: [...brainstormTitles, ...planTitles, 'state.json'],
			error: undefined,
			recordError: undefined,
			attached: [...brainstormTitles, ...planTitles, 'state.json'],
			notesOnTheTicket: '# Shaped in the main checkout\n',
			planDataInsideTheWorktree: false,
		});
	});

	test('ignores a brainstorm notes file that only the worktree holds, publishing the plan generation alone', async () => {
		const { params, assets } = setupPublishFromWorktree({ notesIn: 'worktree' });

		const report = await publishWorkOrderPlan(params);

		expect({
			published: report.published,
			error: report.error,
			recordError: report.recordError,
			attached: attachedTitles(),
			notesOnTheTicket: assets.get(`${planId}--brainstorm-notes.md`),
		}).toStrictEqual({
			published: [...planTitles, 'state.json'],
			error: undefined,
			recordError: undefined,
			attached: [...planTitles, 'state.json'],
			notesOnTheTicket: undefined,
		});
	});
});
