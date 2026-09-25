import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { addWorkOrderPlan } from '#src/workOrder/addWorkOrderPlan.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam mocked: the repository, its linked
// worktree, the record and the plan folder are all real on disk, because the
// claim is about which checkout the plan folder and the record land in.
const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();
/** What `setTicketAttachment` takes, named so the mock and its wrapper each read on one line. */
type AttachmentWrite = { settings: TrackerSettings; ticketId: string; title: string; content: Buffer; contentType: string };

const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/getTicketAttachments.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
}));
jest.mock('#src/ticketTracker/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
jest.mock('#src/ticketTracker/readTicketAsset.ts', () => ({
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
}));
jest.mock('#src/ticketTracker/resolveTrackerSettings.ts', () => ({
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
}));
jest.mock('#src/ticketTracker/setTicketAttachment.ts', () => ({ setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params) }));
// -------------------------

/** The work order's label, which is also the branch the worktree stands on. */
const name = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const env = { LINEAR_API_KEY: 'lin_key' };

/**
 * A real primary checkout with a linked worktree added from it, standing on the
 * ticket's own branch — the shape a plan command runs in once `plan.worktree`
 * moves the session into a tree, and the one place a plan folder could be made
 * in a directory that is removed when the tree is.
 */
const setupAddPlanFromWorktree = async () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd, stdio: 'ignore' });
	// The record is seeded because adding a plan no longer creates one, and it is
	// seeded from the worktree so that even its birth goes to the primary checkout.
	await updateLocalWorkOrderState({
		cwd: worktree,
		name,
		change: () => ({ schemaVersion: 1, name, branch: name, ticketRef: 'lo-140', mode: 'single-plan', plans: [], history: [] }),
	});
	mockGetTicketAttachments.mockResolvedValue([]);
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' } as TrackerTicket]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		worktree,
		primaryTicketFolder: join(realpathSync(cwd), '.lightsout', 'work-orders', name),
		params: { cwd: worktree, name, slug: 'search-basics', config: { gates }, env },
	};
};

describe('addWorkOrderPlan', () => {
	test("a plan added from a linked worktree is created in the primary checkout's plans directory", async () => {
		const { worktree, primaryTicketFolder, params } = await setupAddPlanFromWorktree();

		const result = await addWorkOrderPlan(params);

		// The folder the ticket sync's keep paths read is asked for here the same
		// way they ask for it, so one answer proves both land on one copy.
		const landed = {
			address: 'address' in result ? result.address : result.error,
			planFolderUnderPrimary: existsSync(join(primaryTicketFolder, 'plans', '001-search-basics')),
			recordUnderPrimary: existsSync(join(primaryTicketFolder, 'state.json')),
			folderTheTicketSyncReads: existsSync(await planWorkspaceDir({ cwd: worktree, name: 'lo-140-multi/001-search-basics' })),
			planDataInsideTheWorktree: existsSync(join(worktree, '.lightsout')),
		};

		expect(landed).toStrictEqual({
			address: 'lo-140-multi/001-search-basics',
			planFolderUnderPrimary: true,
			recordUnderPrimary: true,
			folderTheTicketSyncReads: true,
			planDataInsideTheWorktree: false,
		});
	});
});
