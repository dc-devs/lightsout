import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ensurePlanWorkspace } from '#src/cli/common/utils/ensurePlanWorkspace.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planAttachmentManifestName } from '#src/plan/common/constants/planAttachmentManifestName.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

// Mocked Imports
// -------------------------
// The tracker module is the seam: mocking its barrel keeps the network out
// while the real `restorePlanWorkspace` writes into the temp repo, so what this
// gate promises — disk first, then the ticket, then one sentence naming both —
// is asserted against real files. `resolveTrackerSettings` is re-implemented
// rather than stubbed away, because two of the refusals below are its own.
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

const apiKeyEnv = 'LIGHTSOUT_TEST_TRACKER_KEY';
const trackerBlock = { ...ticketTrackerConfigBlock, 'api-key-env': apiKeyEnv };
const name = 'lo-54-portable-plan';
const planPath = join('.lightsout', 'plans', name);
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

	test('fetches the durable files, writes the folder and says so', async () => {
		const cwd = await seedCwd();
		const { result, printed } = await ensure({ cwd });

		expect(result).toBeUndefined();
		expect(readdirSync(join(cwd, planPath))).toStrictEqual(['plan.md']);
		expect(printed).toStrictEqual([`lightsout: fetched 1 plan file(s) from ticket lo-54 into ${join(cwd, planPath)}`]);
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
		const path = join('.lightsout', 'plans', 'portable-plan');
		const { result } = await ensure({ cwd, path });

		expect(result).toStrictEqual({
			error: `no plan at ${join(cwd, path)}, and no plan could be fetched from a ticket: the plan folder name 'portable-plan' carries no ticket id matching this repo's ship.ticket-pattern`,
		});
	});

	test('names the missing folder, ticket and concrete reason when its plan attachments cannot be restored', async () => {
		const cwd = await seedCwd();

		mockGetTicketAttachments.mockResolvedValue({ error: 'no ticket lo-54 in team LO' });

		expect((await ensure({ cwd })).result).toStrictEqual({
			error: `no plan at ${join(cwd, planPath)}, and the plan attachments on ticket lo-54 could not be restored: no ticket lo-54 in team LO`,
		});
	});

	test('names both places and the command that puts a plan on the ticket', async () => {
		const cwd = await seedCwd();

		mockGetTicketAttachments.mockResolvedValue([]);

		expect((await ensure({ cwd })).result).toStrictEqual({
			error: `no plan at ${join(cwd, planPath)}, and ticket lo-54 carries no plan attachment — run \`lightsout plan publish --name ${name}\` from the machine that has the plan`,
		});
	});
});
