import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planAttachmentManifestName, planAttachmentSha256 } from '#src/plan/common/planAttachmentManifest.ts';
import { publishPlan } from '#src/plan/publish/publishPlan.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
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

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** The same block as `ticketTrackerConfigBlock`, typed: the fixture is the raw JSON shape, whose `provider` is a plain string. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };
const overviewBody = ({ phases }: { phases: string[] }) =>
	`# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n${phases.map((phase, index) => `| ${index + 1} | \`${phase}\` | scope |`).join('\n')}\n`;

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
	const dir = join(cwd, '.lightsout', 'plans', folder);
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

describe('publishPlan', () => {
	test('attaches every durable file once, in the resolved order, under its own name and against the ticket’s internal id', async () => {
		const { params } = setupPlan({
			files: { 'overview.md': overviewBody({ phases: ['phase1-seam.md'] }), 'phase1-seam.md': '# one', 'grade.json': '{}', 'facts.json': '{}' },
		});

		const report = await publishPlan(params);

		expect(report).toStrictEqual({
			ticketRef: 'lo-54',
			published: ['overview.md', 'phase1-seam.md', 'grade.json', planAttachmentManifestName],
			stale: [],
		});
		expect(mockSetTicketAttachment.mock.calls.map(([call]) => ({ ticketId: call.ticketId, title: call.title }))).toStrictEqual([
			{ ticketId: 'id-54', title: 'overview.md' },
			{ ticketId: 'id-54', title: 'phase1-seam.md' },
			{ ticketId: 'id-54', title: 'grade.json' },
			{ ticketId: 'id-54', title: planAttachmentManifestName },
		]);
	});

	test('a .json record uploads as JSON and a .md file as markdown, so a human can read the plan in the tracker', async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# plan', 'decisions.json': '[]' } });

		await publishPlan(params);

		expect(mockSetTicketAttachment.mock.calls.map(([call]) => [call.title, call.contentType])).toStrictEqual([
			['plan.md', 'text/markdown'],
			['decisions.json', 'application/json'],
			[planAttachmentManifestName, 'application/json'],
		]);
	});

	test('attaches a schema-1 manifest last, committing the exact names and hashes of the bytes already sent', async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# the plan\n', 'brainstorm-notes.md': '# notes\n' } });

		await publishPlan(params);

		const writes = mockSetTicketAttachment.mock.calls.map(([call]) => call);
		const manifestWrite = writes.at(-1);

		expect(manifestWrite?.title).toBe(planAttachmentManifestName);
		expect(JSON.parse(manifestWrite?.content.toString('utf8') ?? '')).toStrictEqual({
			schemaVersion: 1,
			files: [
				{ name: 'plan.md', sha256: planAttachmentSha256({ content: '# the plan\n' }) },
				{ name: 'brainstorm-notes.md', sha256: planAttachmentSha256({ content: '# notes\n' }) },
			],
		});
	});

	test('sends each file’s own bytes', async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# the plan\n' } });

		await publishPlan(params);

		expect(mockSetTicketAttachment.mock.calls[0]?.[0].content.toString('utf8')).toBe('# the plan\n');
	});

	test('resolves the ticket by the reference the folder’s own name carries, and reads that same ticket’s attachments back', async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# plan' } });

		await publishPlan(params);

		expect({
			lookedUp: mockGetTicketsByIdentifiers.mock.calls[0]?.[0].identifiers,
			readBack: mockGetTicketAttachments.mock.calls[0]?.[0].identifier,
		}).toStrictEqual({ lookedUp: ['lo-54'], readBack: 'lo-54' });
	});

	test('a folder with no deliverable refuses before anything is resolved — no ship settings, no tracker, no call', async () => {
		const { params } = setupPlan({ files: { 'brainstorm-notes.md': '# notes' }, config: { gates } });

		const report = await publishPlan(params);

		expect(report.error ?? '').toMatch(/^nothing to publish for 'lo-54-portable-plan'/);
		expect(report.ticketRef).toBeUndefined();
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('an unusable ship.ticket-pattern is named by key, rather than blamed on the folder', async () => {
		const { params } = setupPlan({
			files: { 'plan.md': '# plan' },
			config: { gates, ship: { 'ticket-pattern': '^(unclosed' }, 'ticket-tracker': trackerBlock },
		});

		const report = await publishPlan(params);

		expect(report.error).toBe(
			"ship.ticket-pattern is not a usable regular expression with a (?<ticket>) group, so publish cannot read a ticket id out of plan folder 'lo-54-portable-plan'",
		);
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('a folder carrying no ticket id refuses before a tracker is resolved, because there is nothing to attach to', async () => {
		const { params } = setupPlan({ folder: 'rate-limit-banner', files: { 'plan.md': '# plan' } });

		const report = await publishPlan(params);

		expect(report.error).toBe(
			"plan folder 'rate-limit-banner' carries no ticket id — name a plan folder after its ticket's branch so publish knows which ticket to attach to",
		);
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('a repo with no ticket-tracker block hears the resolver’s own sentence, and reaches no tracker', async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# plan' }, config: { gates } });

		const report = await publishPlan(params);

		expect(report).toStrictEqual({
			ticketRef: 'lo-54',
			published: [],
			stale: [],
			error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials',
		});
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('a ticket the configured tracker does not have is named without assuming the provider uses teams', async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# plan' }, tickets: [] });

		expect((await publishPlan(params)).error).toBe('there is no lo-54 on the configured ticket tracker');
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('a tracker failure looking the ticket up becomes the report’s error', async () => {
		const { params } = setupPlan({ files: { 'plan.md': '# plan' }, tickets: { error: 'the tracker did not answer' } });

		expect((await publishPlan(params)).error).toBe('the tracker did not answer');
	});

	test('a failure on the third file keeps the two that landed, so a partial publish is visible rather than silent', async () => {
		const { params } = setupPlan({
			files: { 'overview.md': overviewBody({ phases: ['phase1-seam.md'] }), 'phase1-seam.md': '# one', 'grade.json': '{}' },
			uploadFailures: { 'grade.json': "uploading 'grade.json' failed: 403 Forbidden" },
		});

		expect(await publishPlan(params)).toStrictEqual({
			ticketRef: 'lo-54',
			published: ['overview.md', 'phase1-seam.md'],
			stale: [],
			error: "uploading 'grade.json' failed: 403 Forbidden",
		});
	});

	test.each([
		{
			label: 'a missing phase declaration',
			overview: overviewBody({ phases: ['phase1-seam.md', 'phase2-missing.md'] }),
			error: "overview.md's Phases table (phase1-seam.md, phase2-missing.md) does not exactly match the plan generation's phase files (phase1-seam.md)",
		},
		{
			label: 'a duplicate phase declaration',
			overview: overviewBody({ phases: ['phase1-seam.md', 'phase1-seam.md'] }),
			error: 'overview.md lists phase1-seam.md more than once in its Phases table',
		},
	])('refuses $label before any tracker call or mutation', async ({ overview, error }) => {
		const { params } = setupPlan({ files: { 'overview.md': overview, 'phase1-seam.md': '# one' } });

		expect(await publishPlan(params)).toStrictEqual({ ticketRef: 'lo-54', published: [], stale: [], error });
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('reads every durable file before the first tracker mutation', async () => {
		const { params, dir } = setupPlan({ files: { 'plan.md': '# plan' } });

		// A directory under a durable record name exists but cannot be read as the
		// attachment bytes. No earlier file may have reached the ticket.
		mkdirSync(join(dir, 'grade.json'));

		const report = await publishPlan(params);

		expect(report).toMatchObject({
			ticketRef: 'lo-54',
			published: [],
			stale: [],
			error: expect.stringMatching(/^could not read grade\.json before publishing:/),
		});
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('a durable-titled attachment this run did not write is reported and left alone — a stale plan.md from a publish made before the plan was phased', async () => {
		const { params, progress } = setupPlan({
			files: { 'overview.md': overviewBody({ phases: ['phase1-seam.md'] }), 'phase1-seam.md': '# one' },
			attachments: [
				{ id: 'att-1', title: 'overview.md', url: 'https://assets.example/overview.md' },
				{ id: 'att-9', title: 'plan.md', url: 'https://assets.example/plan.md' },
			],
		});

		const report = await publishPlan(params);

		expect(report.stale).toStrictEqual(['plan.md']);
		expect(report.error).toBeUndefined();
		expect(progress.at(-1) ?? '').toMatch(/^plan\.md is a plan file from an earlier publish that this run did not write/);
	});

	test('a working record this run did not write is reported too — a brainstorm-notes.md hand-attached to a ticket whose folder holds none', async () => {
		const { params, progress } = setupPlan({
			files: { 'plan.md': '# plan' },
			attachments: [
				{ id: 'att-1', title: 'plan.md', url: 'https://assets.example/plan.md' },
				{ id: 'att-4', title: 'brainstorm-notes.md', url: 'https://assets.example/brainstorm-notes.md' },
			],
		});

		const report = await publishPlan(params);

		expect(report).toStrictEqual({ ticketRef: 'lo-54', published: ['plan.md', planAttachmentManifestName], stale: ['brainstorm-notes.md'] });
		expect(progress.at(-1) ?? '').toMatch(/^brainstorm-notes\.md is a plan file from an earlier publish that this run did not write/);
	});

	test('an attachment whose title names no plan file is neither reported nor touched', async () => {
		const { params, progress } = setupPlan({
			files: { 'plan.md': '# plan' },
			attachments: [{ id: 'att-9', title: 'screenshot.png', url: 'https://assets.example/screenshot.png' }],
		});

		expect((await publishPlan(params)).stale).toStrictEqual([]);
		expect(progress).toStrictEqual(['attached plan.md to lo-54', `attached ${planAttachmentManifestName} to lo-54`]);
	});

	test('a failure reading the attachment list back leaves the report clean — the files did land — and says so through progress', async () => {
		const { params, progress } = setupPlan({ files: { 'plan.md': '# plan' }, attachments: { error: 'the tracker did not answer' } });

		const report = await publishPlan(params);

		expect(report).toStrictEqual({ ticketRef: 'lo-54', published: ['plan.md', planAttachmentManifestName], stale: [] });
		expect(progress.at(-1)).toBe("could not read lo-54's attachment list back: the tracker did not answer");
	});
});
