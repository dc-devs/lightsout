import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planAttachmentManifestName } from '#src/plan/common/constants/planAttachmentManifestName.ts';
import { publishPlan } from '#src/plan/publish/publishPlan.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker module is the seam this work exists to keep: mocking its barrel
// is what lets a publish be asserted end to end without a network. The plan
// folder itself is real and temporary, because the durable set is a disk read.
type TrackerFailure = { error: string };
type TrackerTicket = { id: string; identifier: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();
const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
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
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------
// Publishing under a plan id prefix is the same upload with a different
// namespace, so this file keeps the prefixed half of the contract: what the
// titles and the marker say, which stale titles are its own, and that a bare
// publish still ignores every prefixed title. The unprefixed half lives beside
// it in publishPlan.unit.test.ts.

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };

const setupPlan = ({
	folder = 'lo-54-portable-plan',
	files,
	config,
	tickets = [{ id: 'id-54', identifier: 'LO-54' }],
	attachments = [],
	uploadFailures = {},
}: {
	folder?: string;
	files: Record<string, string>;
	config?: LightsoutConfig;
	/** What the ticket lookup answers: the one ticket by default. */
	tickets?: TrackerTicket[] | TrackerFailure;
	/** What the read-back answers: nothing on the ticket by default. */
	attachments?: Attachment[] | TrackerFailure;
	/** Each attachment title the tracker refuses, and the sentence it refuses with. */
	uploadFailures?: Record<string, string>;
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-publish-plan-'));
	const dir = planWorkspaceFolder({ cwd: cwd, name: folder });
	const progress: string[] = [];

	mockGetTicketsByIdentifiers.mockResolvedValue(tickets);
	mockGetTicketAttachments.mockResolvedValue(attachments);
	mockSetTicketAttachment.mockImplementation(async ({ title }) => {
		const failure = uploadFailures[title];

		return failure === undefined ? undefined : { error: failure };
	});

	mkdirSync(dir, { recursive: true });

	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(dir, name), text);
	}

	return {
		dir,
		progress,
		params: {
			cwd,
			name: folder,
			config: config ?? { gates, 'ticket-tracker': trackerBlock },
			env,
			onProgress: (message: string) => progress.push(message),
		},
	};
};

describe('publishPlan under a plan id prefix', () => {
	test("publishPlan: with a title prefix, attaches every file and the marker under the plan's prefix, lists bare names in the marker, and leaves brainstorm-notes.md out", async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# the plan\n', 'decisions.json': '[]\n', 'brainstorm-notes.md': '# notes\n' } });

		const report = await publishPlan({ ...params, titlePrefix: '001-search' });

		const writes = mockSetTicketAttachment.mock.calls.map(([call]) => call);

		expect({ published: report.published, titles: writes.map(({ title }) => title) }).toStrictEqual({
			published: ['001-search--plan.md', '001-search--decisions.json', '001-search--plan-attachments.json'],
			titles: ['001-search--plan.md', '001-search--decisions.json', '001-search--plan-attachments.json'],
		});
		expect(JSON.parse(writes.at(-1)?.content.toString('utf8') ?? '')).toStrictEqual({
			schemaVersion: 1,
			files: [
				{ name: 'plan.md', sha256: sha256({ content: '# the plan\n' }) },
				{ name: 'decisions.json', sha256: sha256({ content: '[]\n' }) },
			],
		});
	});

	test('publishPlan: reports the SHA-256 of the committed marker only when the marker landed', async () => {
		const landed = setupPlan({ files: { 'plan.md': '# the plan\n' } });

		const report = await publishPlan({ ...landed.params, titlePrefix: '001-search' });

		const markerWrite = mockSetTicketAttachment.mock.calls.at(-1)?.[0];

		// the hash is of the marker's own bytes, so the last write has to be the marker
		expect(markerWrite?.title).toBe(`001-search--${planAttachmentManifestName}`);
		expect(report.markerSha256).toBe(sha256({ content: markerWrite?.content ?? Buffer.alloc(0) }));

		const refused = setupPlan({
			files: { 'plan.md': '# the plan\n' },
			uploadFailures: { '001-search--plan-attachments.json': "uploading '001-search--plan-attachments.json' failed: 403 Forbidden" },
		});

		const refusedReport = await publishPlan({ ...refused.params, titlePrefix: '001-search' });

		expect(refusedReport).toStrictEqual({
			ticketRef: 'lo-54',
			published: ['001-search--plan.md'],
			stale: [],
			error: "uploading '001-search--plan-attachments.json' failed: 403 Forbidden",
		});
	});

	test("publishPlan: with a title prefix, reports only stale titles under its own prefix and never another plan's, the brainstorm's or a bare title", async () => {
		const { params } = setupPlan({
			files: { 'plan.md': '# plan' },
			attachments: [
				{ id: 'att-1', title: '001-search--overview.md', url: 'https://assets.example/one-overview.md' },
				{ id: 'att-2', title: '002-other--plan.md', url: 'https://assets.example/two-plan.md' },
				{ id: 'att-3', title: '001-search--brainstorm-notes.md', url: 'https://assets.example/one-notes.md' },
				{ id: 'att-4', title: 'plan.md', url: 'https://assets.example/bare-plan.md' },
			],
		});

		const report = await publishPlan({ ...params, titlePrefix: '001-search' });

		expect(report.stale).toStrictEqual(['001-search--overview.md']);
		// a stale title is reported, never a refusal
		expect(report.error).toBeUndefined();
	});

	test('publishPlan: without a title prefix, keeps bare titles and brainstorm-notes.md and ignores prefixed titles and ticket.json on the ticket', async () => {
		const { params } = setupPlan({
			files: { 'plan.md': '# plan', 'brainstorm-notes.md': '# notes' },
			attachments: [
				{ id: 'att-1', title: '001-x--plan.md', url: 'https://assets.example/one-plan.md' },
				{ id: 'att-2', title: 'ticket.json', url: 'https://assets.example/ticket.json' },
			],
		});

		const report = await publishPlan(params);

		expect(report).toEqual(
			expect.objectContaining({
				ticketRef: 'lo-54',
				published: ['plan.md', 'brainstorm-notes.md', planAttachmentManifestName],
				stale: [],
			}),
		);
	});
});
