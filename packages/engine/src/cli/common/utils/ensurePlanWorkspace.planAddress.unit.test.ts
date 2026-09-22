import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ensurePlanWorkspace } from '#src/cli/common/utils/ensurePlanWorkspace.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { type LightsoutConfig, PlanProgress, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import { planAttachmentManifestName } from '#src/plan/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

// Mocked Imports
// -------------------------
// The tracker module is the seam: mocking its barrel keeps the network out
// while the rest of the gate runs against real files, so what it promises —
// disk first, then the ticket, then one sentence naming both — is asserted
// against what landed. `resolveTrackerSettings` is re-implemented rather than
// stubbed away, so the settings every row is given are the ones the real
// resolver would answer.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined) {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		const apiKey = env[block['api-key-env']] ?? '';

		return block.provider === 'linear'
			? { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey }
			: {
					provider: 'jira',
					ticketPrefix: block.project,
					siteUrl: block['site-url'].replace(/\/$/u, ''),
					project: block.project,
					apiKey,
					apiUserEmail: env[block['api-user-email-env']] ?? '',
				};
	},
}));
// -------------------------
// The work order module is the second seam. This gate only orchestrates it —
// pull the record, then restore the addressed plan's own generation — so the
// stand-ins below write the files those functions promise, and the tests read
// what landed on disk rather than which mock ran.
type PullAnswer = { record: WorkOrderState | undefined } | { error: string };
type RestoreAnswer = { restored: string[] } | { error: string };

const mockPullTicketRecord = jest.fn<(params: { cwd: string; name: string }) => Promise<PullAnswer>>();
const mockRestoreTicketPlan = jest.fn<(params: { cwd: string; address: string }) => Promise<RestoreAnswer>>();

jest.mock('#src/workOrder/index.ts', () => ({
	pullWorkOrderState: (params: { cwd: string; name: string }) => mockPullTicketRecord(params),
	restoreWorkOrderPlan: (params: { cwd: string; address: string }) => mockRestoreTicketPlan(params),
}));
// -------------------------
// A plan is fetched through the work order state and its own prefixed
// generation, so this file keeps that half of the gate: the work order
// branch's worktree, the record, and the plan's own generation. The gate's
// input checks live beside it in ensurePlanWorkspace.unit.test.ts.

const apiKeyEnv = 'LIGHTSOUT_TEST_TRACKER_KEY';
const trackerBlock = { ...ticketTrackerConfigBlock, 'api-key-env': apiKeyEnv };
const planBody = '# plan restored from the ticket\n';

/** A repo carrying the tracker block, with one bare-title plan.md waiting on the ticket that no plan address may take. */
const seedCwd = async () => {
	const manifest = serializeAttachmentManifest({ files: [{ name: 'plan.md', content: Buffer.from(planBody, 'utf8') }] }).toString('utf8');

	mockGetTicketAttachments.mockResolvedValue([
		{ id: 'att-1', title: 'plan.md', url: 'https://assets.example/plan.md' },
		{ id: 'att-2', title: planAttachmentManifestName, url: `https://assets.example/${planAttachmentManifestName}` },
	]);
	mockReadTicketAsset.mockImplementation(async ({ url }) => (url.endsWith(planAttachmentManifestName) ? manifest : planBody));

	return seedConfiguredCwd({ config: { 'ticket-tracker': trackerBlock } });
};

const ensure = ({ cwd, path }: { cwd: string; path: string }) => {
	const printed: string[] = [];

	return ensurePlanWorkspace({ cwd, planPath: path, write: (line) => printed.push(line) }).then((result) => ({ result, printed }));
};

const workOrderName = 'lo-7-search';
const laterPlanPath = join('.lightsout', 'work-orders', workOrderName, 'plans', '002-ranking');
const laterPlanBody = '# the later plan, planned in the ticket tree\n';

/**
 * A later plan's folder waiting in the ticket branch's own worktree, with the
 * ticket able to supply that plan: the tree is keyed by the ticket-branch
 * segment of the plan address, so it sits at `<cwd>-worktrees/lo-7-search`, and
 * the folder it holds is that tree's
 * `.lightsout/work-orders/lo-7-search/plans/002-ranking`.
 *
 * The tree's copy is no longer a source to recover from, so the ticket is the
 * only place left to ask — and it answers with text of its own, which is what
 * tells the two copies apart afterwards.
 */
const setupPlanInTicketWorktree = async () => {
	const cwd = await seedCwd();
	const tree = join(`${cwd}-worktrees`, workOrderName);
	const dir = join(tree, '.lightsout', 'work-orders', workOrderName, 'plans', '002-ranking');

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), laterPlanBody);
	writeFileSync(join(dir, 'grade-memory.json'), '{"passes":2}\n');

	mockPullTicketRecord.mockResolvedValue({ record: ticketRecord });
	mockRestoreTicketPlan.mockImplementation(async ({ cwd: checkout, address }) => {
		mkdirSync(planWorkspaceFolder({ cwd: checkout, name: address }), { recursive: true });
		writeFileSync(join(planWorkspaceFolder({ cwd: checkout, name: address }), 'plan.md'), restoredFileBody);

		return { restored: ['plan.md'] };
	});

	return { cwd, tree, worktreeDir: dir };
};

const recordedBranch = 'lo-9-x';
const recordedPlanPath = join('.lightsout', 'work-orders', recordedBranch, 'plans', '002-fix');
const recordedTicketFolder = join('.lightsout', 'work-orders', recordedBranch);
const recordedPlansFolder = join(recordedTicketFolder, 'plans');
const restoredFileBody = '# plan 002, restored from its own prefixed generation\n';

const ticketRecord: WorkOrderState = {
	schemaVersion: 1,
	name: recordedBranch,
	ticketRef: 'lo-9',
	branch: recordedBranch,
	mode: WorkOrderMode.MultiplePlan,
	plans: [{ id: '002-fix', title: 'Fix the ranking', progress: PlanProgress.Ready, createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [],
};

/**
 * A repo whose addressed plan is on no disk this gate can see, with stand-ins
 * for the two ticket-module steps it orchestrates: the pull writes state.json
 * into the ticket folder of the checkout it was given, and the restore writes
 * the plan's own generation into the addressed folder. `inWorktree` puts a copy
 * of the plan folder in the ticket branch's tree at `<cwd>-worktrees/lo-9-x`.
 */
const setupAddressedPlan = async ({
	pull = { record: ticketRecord },
	restore = { restored: ['brainstorm-notes.md', 'plan.md'] },
	inWorktree,
}: {
	pull?: PullAnswer;
	restore?: RestoreAnswer;
	inWorktree?: Record<string, string>;
} = {}) => {
	const cwd = await seedCwd();
	const tree = join(`${cwd}-worktrees`, recordedBranch);

	mockPullTicketRecord.mockImplementation(async ({ cwd: checkout, name: branch }) => {
		if ('record' in pull && pull.record !== undefined) {
			mkdirSync(planWorkspaceFolder({ cwd: checkout, name: branch }), { recursive: true });
			writeFileSync(join(checkout, '.lightsout', 'work-orders', branch, 'state.json'), JSON.stringify(pull.record));
		}

		return pull;
	});
	mockRestoreTicketPlan.mockImplementation(async ({ cwd: checkout, address }) => {
		for (const file of 'restored' in restore ? restore.restored : []) {
			mkdirSync(planWorkspaceFolder({ cwd: checkout, name: address }), { recursive: true });
			writeFileSync(join(planWorkspaceFolder({ cwd: checkout, name: address }), file), restoredFileBody);
		}

		return restore;
	});

	if (inWorktree !== undefined) {
		mkdirSync(join(tree, recordedPlanPath), { recursive: true });

		for (const [file, content] of Object.entries(inWorktree)) {
			writeFileSync(join(tree, recordedPlanPath, file), content);
		}
	}

	return { cwd, tree };
};

describe('ensurePlanWorkspace for a plan address', () => {
	test("a plan address's folder sitting in the ticket branch's worktree is never recovered from it", async () => {
		const { cwd, tree, worktreeDir } = await setupPlanInTicketWorktree();

		const { result, printed } = await ensure({ cwd, path: laterPlanPath });

		expect({
			result,
			writtenFiles: readdirSync(join(cwd, laterPlanPath)).sort(),
			writtenPlan: readFileSync(join(cwd, laterPlanPath, 'plan.md'), 'utf8'),
			worktreeFiles: readdirSync(worktreeDir).sort(),
			printed,
			restoreCalls: mockRestoreTicketPlan.mock.calls.length,
		}).toEqual({
			result: undefined,
			// the ticket's own text, not the tree's, and the tree is left as it was
			writtenFiles: ['plan.md'],
			writtenPlan: restoredFileBody,
			worktreeFiles: ['grade-memory.json', 'plan.md'],
			printed: [expect.stringContaining(join(cwd, laterPlanPath))],
			restoreCalls: 1,
		});
		expect(printed.join('\n')).not.toContain(tree);
	});

	test("ensurePlanWorkspace: for a plan address, restores the ticket record and the plan's prefixed generation and says so", async () => {
		const { cwd } = await setupAddressedPlan();

		const { result, printed } = await ensure({ cwd, path: recordedPlanPath });

		const settled = JSON.parse(readFileSync(join(cwd, recordedTicketFolder, 'state.json'), 'utf8')) as WorkOrderState;

		expect({
			result,
			recordBranch: settled.branch,
			recordPlans: settled.plans.map((plan) => plan.id),
			restoredFiles: readdirSync(join(cwd, recordedPlanPath)).sort(),
			printed,
		}).toStrictEqual({
			result: undefined,
			recordBranch: 'lo-9-x',
			recordPlans: ['002-fix'],
			restoredFiles: ['brainstorm-notes.md', 'plan.md'],
			printed: [`lightsout: fetched 2 plan file(s) from ticket lo-9 into ${join(cwd, recordedPlanPath)}`],
		});
	});

	test("ensurePlanWorkspace: for a plan address, a copy in the ticket branch's worktree is passed over for the ticket", async () => {
		const { cwd, tree } = await setupAddressedPlan({
			inWorktree: { 'plan.md': '# planned in the ticket branch tree\n', 'grade-memory.json': '{"passes":1}\n' },
		});

		const { result, printed } = await ensure({ cwd, path: recordedPlanPath });

		expect({
			result,
			writtenFiles: readdirSync(join(cwd, recordedPlanPath)).sort(),
			writtenPlan: readFileSync(join(cwd, recordedPlanPath, 'plan.md'), 'utf8'),
			worktreeFiles: readdirSync(join(tree, recordedPlanPath)).sort(),
			printed,
			pullCalls: mockPullTicketRecord.mock.calls.length,
			restoreCalls: mockRestoreTicketPlan.mock.calls.length,
		}).toEqual({
			result: undefined,
			// the ticket's generation, not the tree's copy, and the tree untouched
			writtenFiles: ['brainstorm-notes.md', 'plan.md'],
			writtenPlan: restoredFileBody,
			worktreeFiles: ['grade-memory.json', 'plan.md'],
			printed: [`lightsout: fetched 2 plan file(s) from ticket lo-9 into ${join(cwd, recordedPlanPath)}`],
			pullCalls: 1,
			restoreCalls: 1,
		});
	});

	test('ensurePlanWorkspace: for a plan address, names the missing folder and the ticket record divergence', async () => {
		const divergence =
			'the local ticket record and the published one both moved — the published copy was saved as state.published.json, so run `lightsout work-order sync --name lo-9-x` with --keep local or --keep published';
		const { cwd } = await setupAddressedPlan({ pull: { error: divergence } });

		const { result } = await ensure({ cwd, path: recordedPlanPath });

		expect({
			result,
			folderWritten: existsSync(join(cwd, recordedPlanPath)),
			restoreCalls: mockRestoreTicketPlan.mock.calls.length,
		}).toEqual({
			result: { error: expect.stringContaining(join(cwd, recordedPlanPath)) },
			folderWritten: false,
			restoreCalls: 0,
		});
		expect(result?.error).toContain(divergence);
	});

	test("ensurePlanWorkspace: for a plan address, names the missing folder and the concrete reason the plan's own generation could not be restored", async () => {
		const reason = '002-fix--plan.md does not match the SHA-256 committed by 002-fix--plan-attachments.json';
		const { cwd } = await setupAddressedPlan({ restore: { error: reason } });

		const { result } = await ensure({ cwd, path: recordedPlanPath });

		// the record settled, so the sentence blames the plan's own generation and
		// names it — and no half-written folder is left to win the disk-first check
		expect({ result, folderWritten: existsSync(join(cwd, recordedPlanPath)) }).toStrictEqual({
			result: { error: `no plan at ${join(cwd, recordedPlanPath)}, and the plan attachments on ticket lo-9 could not be restored: ${reason}` },
			folderWritten: false,
		});
	});

	test('ensurePlanWorkspace: for a plan address with no published generation, names plan publish with the address', async () => {
		const { cwd } = await setupAddressedPlan({ restore: { restored: [] } });

		const { result } = await ensure({ cwd, path: recordedPlanPath });

		expect({ result, folderWritten: existsSync(join(cwd, recordedPlanPath)) }).toEqual({
			result: { error: expect.stringContaining('`lightsout plan publish --name lo-9-x/002-fix`') },
			folderWritten: false,
		});
	});

	// A path inside a work order's plans folder that is not a plan folder is no
	// plan workspace of its own, so the gate leaves it exactly as it found it
	// rather than restoring a single-folder generation into it.
	test('leaves a non-address plan path alone instead of restoring into it', async () => {
		const { cwd } = await setupAddressedPlan();

		const { result, printed } = await ensure({ cwd, path: recordedPlansFolder });

		expect({
			result,
			printed,
			folderWritten: existsSync(join(cwd, recordedPlansFolder)),
			pullCalls: mockPullTicketRecord.mock.calls.length,
			restoreCalls: mockRestoreTicketPlan.mock.calls.length,
			trackerCalls: mockGetTicketAttachments.mock.calls.length,
		}).toStrictEqual({
			result: undefined,
			printed: [],
			folderWritten: false,
			pullCalls: 0,
			restoreCalls: 0,
			trackerCalls: 0,
		});
	});
});
