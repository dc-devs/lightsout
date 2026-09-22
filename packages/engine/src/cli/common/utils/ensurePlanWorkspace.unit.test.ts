import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ensurePlanWorkspace } from '#src/cli/common/utils/ensurePlanWorkspace.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planAttachmentManifestName } from '#src/plan/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

// Mocked Imports
// -------------------------
// The tracker module is the seam: mocking its barrel keeps the network out
// while the gate's own input checks run against real files, so what this half
// promises — a path that is no plan workspace at all, disk winning outright,
// and one sentence naming which part of the repo is missing — is asserted
// against real files. `resolveTrackerSettings` is re-implemented rather than
// stubbed away, because two of the refusals below are its own.
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
// The work order module is the second seam, and none of the rows below may
// reach it: each one is answered by the gate's own input checks, before there
// is a record to settle or a generation to restore. Both steps are stubbed to
// reject, so a row that silently took one would fail rather than pass. The
// fetch itself lives beside this file in ensurePlanWorkspace.planAddress.unit.test.ts.
jest.mock('#src/workOrder/index.ts', () => ({
	pullWorkOrderState: () => Promise.reject(new Error('a refused plan path must not pull a work order state')),
	restoreWorkOrderPlan: () => Promise.reject(new Error('a refused plan path must not restore a plan')),
}));
// -------------------------

const apiKeyEnv = 'LIGHTSOUT_TEST_TRACKER_KEY';
const trackerBlock = { ...ticketTrackerConfigBlock, 'api-key-env': apiKeyEnv };
const name = 'lo-54-portable-plan';
const planPath = join('.lightsout', 'work-orders', name, 'plans', '001-portable-plan');
const planBody = '# plan restored from the ticket\n';

/** A repo carrying the tracker block by default, with one plan.md waiting on the ticket. */
const seedCwd = async ({ config = { 'ticket-tracker': trackerBlock } }: { config?: Record<string, unknown> } = {}) => {
	const manifest = serializeAttachmentManifest({ files: [{ name: 'plan.md', content: Buffer.from(planBody, 'utf8') }] }).toString('utf8');

	mockGetTicketAttachments.mockResolvedValue([
		{ id: 'att-1', title: 'plan.md', url: 'https://assets.example/plan.md' },
		{ id: 'att-2', title: planAttachmentManifestName, url: `https://assets.example/${planAttachmentManifestName}` },
	]);
	mockReadTicketAsset.mockImplementation(async ({ url }) => (url.endsWith(planAttachmentManifestName) ? manifest : planBody));

	return seedConfiguredCwd({ config });
};

const ensure = ({ cwd, path = planPath }: { cwd: string; path?: string }) => {
	const printed: string[] = [];

	return ensurePlanWorkspace({ cwd, planPath: path, write: (line) => printed.push(line) }).then((result) => ({ result, printed }));
};

/**
 * A plan folder sitting in the plan's own worktree. A temp checkout belongs to
 * no repository, so its worktrees root is its own `-worktrees` sibling and the
 * plan's tree is `<cwd>-worktrees/<work order name>` — no git, and no ownership
 * record, because a folder being there is all this gate asks.
 */
const seedWorktreePlan = ({ cwd, planName, files }: { cwd: string; planName: string; files: Record<string, string> }) => {
	const tree = join(`${cwd}-worktrees`, planName.split('/')[0] ?? planName);
	const dir = planWorkspaceFolder({ cwd: tree, name: planName });

	mkdirSync(dir, { recursive: true });

	for (const [file, content] of Object.entries(files)) {
		writeFileSync(join(dir, file), content);
	}

	return { tree, dir };
};

describe('ensurePlanWorkspace', () => {
	test('a plan folder already on disk wins outright — the tracker is never asked', async () => {
		const cwd = await seedCwd();

		mkdirSync(join(cwd, planPath), { recursive: true });
		writeFileSync(join(cwd, planPath, 'plan.md'), '# the plan on this machine\n');

		expect(await ensure({ cwd })).toStrictEqual({ result: undefined, printed: [] });
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test('a --plan outside the repo plans directory has no plan workspace to fetch, and is left alone', async () => {
		const cwd = await seedCwd();

		expect(await ensure({ cwd, path: 'docs/some-plan.md' })).toStrictEqual({ result: undefined, printed: [] });
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test('names the missing folder and the missing config when the repo has none', async () => {
		const cwd = await freshCwd();
		const { result } = await ensure({ cwd });

		expect(result).toStrictEqual({
			error: `no plan at ${join(cwd, planPath)}, and no plan could be fetched from the ticket: this repo has no lightsout.config.json, so it names no ticket tracker`,
		});
	});

	test('names the missing folder and the missing ticket-tracker block', async () => {
		const cwd = await seedCwd({ config: {} });
		const { result } = await ensure({ cwd });

		expect(result).toStrictEqual({
			error: `no plan at ${join(cwd, planPath)}, and no plan could be fetched from the ticket: this command needs a \`ticket-tracker\` block in lightsout.config.json naming a provider and its credentials`,
		});
	});

	test('names the missing folder and the unusable ticket pattern', async () => {
		const cwd = await seedCwd({ config: { 'ticket-tracker': trackerBlock, ship: { 'ticket-pattern': '(' } } });
		const { result } = await ensure({ cwd });

		expect(result).toStrictEqual({
			error: `no plan at ${join(cwd, planPath)}, and the ticket to fetch one from cannot be read: ship.ticket-pattern is not a regular expression capturing a 'ticket' group`,
		});
	});

	test('names the missing folder and the folder name carrying no ticket id', async () => {
		const cwd = await seedCwd();
		const path = join('.lightsout', 'work-orders', 'portable-plan', 'plans', '001-portable-plan');
		const { result } = await ensure({ cwd, path });

		expect(result).toStrictEqual({
			error: `no plan at ${join(cwd, path)}, and no plan could be fetched from a ticket: the plan folder name 'portable-plan/001-portable-plan' carries no ticket id matching this repo's ship.ticket-pattern`,
		});
	});

	test('a ticketless plan folder sitting in a worktree is never recovered from it', async () => {
		const cwd = await seedCwd();
		const path = join('.lightsout', 'work-orders', 'portable-plan', 'plans', '001-portable-plan');
		const { tree, dir } = seedWorktreePlan({
			cwd,
			planName: 'portable-plan/001-portable-plan',
			files: { 'plan.md': '# the plan graded in its worktree\n', 'grade-memory.json': '{"passes":1}\n' },
		});

		const { result, printed } = await ensure({ cwd, path });

		// The name carries no ticket id, so there is nowhere left to ask: the tree's
		// copy is not a source, and the refusal names the missing folder alone.
		expect({
			error: result?.error,
			folderWritten: existsSync(join(cwd, path)),
			worktreeFiles: readdirSync(dir).sort(),
			printed,
			trackerCalls: mockGetTicketAttachments.mock.calls.length,
		}).toEqual({
			error: `no plan at ${join(cwd, path)}, and no plan could be fetched from a ticket: the plan folder name 'portable-plan/001-portable-plan' carries no ticket id matching this repo's ship.ticket-pattern`,
			folderWritten: false,
			worktreeFiles: ['grade-memory.json', 'plan.md'],
			printed: [],
			trackerCalls: 0,
		});
		expect(result?.error).not.toContain(tree);
	});
});
