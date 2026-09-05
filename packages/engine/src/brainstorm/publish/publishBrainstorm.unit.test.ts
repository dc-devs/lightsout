import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { publishBrainstorm } from '#src/brainstorm/publish/publishBrainstorm.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the one seam: mocking it lets a publish be asserted end
// to end with no network, while the brainstorm folder itself is real and
// temporary, because the two files are a disk read.
type TrackerFailure = { error: string };
type TrackerTicket = { id: string; identifier: string };
type AttachmentWrite = { ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
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

const setupBrainstorm = ({
	folder = 'lo-117-brainstorm-decides-its-outcome',
	files = { 'brainstorm-notes.md': '# the design\n', 'brainstorm-decisions.json': '[]\n' },
	tickets = [{ id: 'id-117', identifier: 'LO-117' }],
	uploadFailures = {},
}: {
	folder?: string;
	/** What the brainstorm folder holds on disk: both files by default. */
	files?: Record<string, string>;
	/** What the ticket lookup answers: the one ticket by default. */
	tickets?: TrackerTicket[] | TrackerFailure;
	/** Each attachment title the tracker refuses, and the sentence it refuses with. */
	uploadFailures?: Record<string, string>;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-publish-brainstorm-'));
	const dir = join(cwd, '.lightsout', 'plans', folder);
	const progress: string[] = [];

	mockGetTicketsByIdentifiers.mockResolvedValue(tickets);
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
			config: { gates, 'ticket-tracker': trackerBlock },
			env,
			onProgress: (message: string) => progress.push(message),
		},
	};
};

describe('publishBrainstorm', () => {
	test('publishBrainstorm: attaches both brainstorm files and commits them with brainstorm-attachments.json last', async () => {
		const { params } = setupBrainstorm();

		const report = await publishBrainstorm(params);

		expect(report).toStrictEqual({
			ticketRef: 'lo-117',
			published: ['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-attachments.json'],
		});
		expect(mockSetTicketAttachment.mock.calls.map(([call]) => ({ ticketId: call.ticketId, title: call.title }))).toStrictEqual([
			{ ticketId: 'id-117', title: 'brainstorm-notes.md' },
			{ ticketId: 'id-117', title: 'brainstorm-decisions.json' },
			{ ticketId: 'id-117', title: 'brainstorm-attachments.json' },
		]);
	});

	test('publishBrainstorm: refuses with no tracker write when brainstorm-decisions.json is not on disk', async () => {
		const { params } = setupBrainstorm({ files: { 'brainstorm-notes.md': '# the design\n' } });

		const report = await publishBrainstorm(params);

		expect(report.published).toStrictEqual([]);
		expect(report.error ?? '').toMatch(/brainstorm-decisions\.json/u);
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('publishBrainstorm: refuses a folder name carrying no ticket id', async () => {
		const { params } = setupBrainstorm({ folder: 'brainstorm-decides-its-outcome' });

		const report = await publishBrainstorm(params);

		expect(report.published).toStrictEqual([]);
		expect(report.error ?? '').toMatch(/'brainstorm-decides-its-outcome'[\s\S]*carries no ticket id/u);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('publishBrainstorm: reports the files that landed when the tracker refuses the second attachment', async () => {
		const { params } = setupBrainstorm({
			uploadFailures: { 'brainstorm-decisions.json': "uploading 'brainstorm-decisions.json' failed: 403 Forbidden" },
		});

		const report = await publishBrainstorm(params);

		expect(report).toStrictEqual({
			ticketRef: 'lo-117',
			published: ['brainstorm-notes.md'],
			error: "uploading 'brainstorm-decisions.json' failed: 403 Forbidden",
		});
		expect(mockSetTicketAttachment.mock.calls.map(([call]) => call.title)).toStrictEqual(['brainstorm-notes.md', 'brainstorm-decisions.json']);
	});
});
