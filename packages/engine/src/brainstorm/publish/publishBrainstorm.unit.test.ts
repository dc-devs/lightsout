import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { publishBrainstorm } from '#src/brainstorm/publish/publishBrainstorm.ts';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

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
	ticketRef = 'lo-117',
}: {
	folder?: string;
	/** What the brainstorm folder holds on disk: both files by default. */
	files?: Record<string, string>;
	/** What the ticket lookup answers: the one ticket by default. */
	tickets?: TrackerTicket[] | TrackerFailure;
	/** Each attachment title the tracker refuses, and the sentence it refuses with. */
	uploadFailures?: Record<string, string>;
	/** The ticket the brainstorm's work order belongs to, as its record carries it. `null` names a work order that belongs to none. */
	ticketRef?: string | null;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-publish-brainstorm-'));
	const dir = planWorkspaceFolder({ cwd: cwd, name: folder });
	const progress: string[] = [];

	mockGetTicketsByIdentifiers.mockResolvedValue(tickets);
	mockSetTicketAttachment.mockImplementation(async ({ title }) => {
		const failure = uploadFailures[title];

		return failure === undefined ? undefined : { error: failure };
	});

	mkdirSync(dir, { recursive: true });
	// Which ticket a generation publishes to is the work order record's answer,
	// not the folder name's, so the record comes before the files.
	seedWorkOrderRecord({ cwd, name: workOrderNameOf({ name: folder }), ticketRef: ticketRef ?? undefined });

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

/**
 * A work order whose folder label spells no ticket id at all, with its record
 * naming one — so the reference the publish attaches to can only have come from
 * the record.
 */
const setupRecordedWorkOrder = () => {
	const { params } = setupBrainstorm({ folder: 'alpha-redesign', tickets: [{ id: 'id-901', identifier: 'LO-901' }], ticketRef: 'LO-901' });

	seedWorkOrderRecord({ cwd: params.cwd, name: 'alpha-redesign', branch: 'feature/alpha-redesign', ticketRef: 'LO-901' });

	return { params };
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

	test('publishBrainstorm: refuses a work order whose record carries no ticket reference', async () => {
		const { params } = setupBrainstorm({ folder: 'brainstorm-decides-its-outcome', ticketRef: null });

		const report = await publishBrainstorm(params);

		expect(report.published).toStrictEqual([]);
		expect(report.error ?? '').toMatch(/'brainstorm-decides-its-outcome'[\s\S]*carries no ticket reference/u);
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

	test("publishBrainstorm: with a title prefix, publishes brainstorm-notes.md alone when brainstorm-decisions.json is absent, under the plan's prefix", async () => {
		const { params } = setupBrainstorm({
			folder: 'lo-117-brainstorm-decides-its-outcome/001-x',
			files: { 'brainstorm-notes.md': '# the design\n' },
		});

		const report = await publishBrainstorm({ ...params, titlePrefix: '001-x' });

		const marker = mockSetTicketAttachment.mock.calls.map(([call]) => call).at(-1);
		expect(report).toStrictEqual({
			ticketRef: 'lo-117',
			published: ['001-x--brainstorm-notes.md', '001-x--brainstorm-attachments.json'],
		});
		expect(mockSetTicketAttachment.mock.calls.map(([call]) => call.title)).toStrictEqual(['001-x--brainstorm-notes.md', '001-x--brainstorm-attachments.json']);
		expect(marker?.title).toBe('001-x--brainstorm-attachments.json');
		expect(JSON.parse(marker?.content.toString('utf8') ?? '')).toStrictEqual({
			schemaVersion: 1,
			files: [{ name: 'brainstorm-notes.md', sha256: sha256({ content: '# the design\n' }) }],
		});
	});

	test("publishBrainstorm: with a title prefix, attaches both files and the marker under the plan's prefix", async () => {
		const { params } = setupBrainstorm({ folder: 'lo-117-brainstorm-decides-its-outcome/001-x' });

		const report = await publishBrainstorm({ ...params, titlePrefix: '001-x' });

		const marker = mockSetTicketAttachment.mock.calls.map(([call]) => call).at(-1);
		expect(report).toStrictEqual({
			ticketRef: 'lo-117',
			published: ['001-x--brainstorm-notes.md', '001-x--brainstorm-decisions.json', '001-x--brainstorm-attachments.json'],
		});
		expect(mockSetTicketAttachment.mock.calls.map(([call]) => ({ ticketId: call.ticketId, title: call.title }))).toStrictEqual([
			{ ticketId: 'id-117', title: '001-x--brainstorm-notes.md' },
			{ ticketId: 'id-117', title: '001-x--brainstorm-decisions.json' },
			{ ticketId: 'id-117', title: '001-x--brainstorm-attachments.json' },
		]);
		expect(marker?.title).toBe('001-x--brainstorm-attachments.json');
		expect(JSON.parse(marker?.content.toString('utf8') ?? '')).toStrictEqual({
			schemaVersion: 1,
			files: [
				{ name: 'brainstorm-notes.md', sha256: sha256({ content: '# the design\n' }) },
				{ name: 'brainstorm-decisions.json', sha256: sha256({ content: '[]\n' }) },
			],
		});
	});

	test('publishBrainstorm: with a title prefix, refuses with no tracker write when brainstorm-notes.md is not on disk', async () => {
		const { params } = setupBrainstorm({
			folder: 'lo-117-brainstorm-decides-its-outcome/001-x',
			files: { 'brainstorm-decisions.json': '[]\n' },
		});

		const report = await publishBrainstorm({ ...params, titlePrefix: '001-x' });

		expect(report.published).toStrictEqual([]);
		expect(report.error ?? '').toMatch(/brainstorm-notes\.md/u);
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test("publishes to the ticket the work order's record names", async () => {
		const { params } = setupRecordedWorkOrder();

		const report = await publishBrainstorm(params);

		expect(report).toStrictEqual({
			ticketRef: 'LO-901',
			published: ['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-attachments.json'],
		});
		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith(expect.objectContaining({ identifiers: ['LO-901'] }));
		expect(mockSetTicketAttachment.mock.calls.map(([call]) => call.ticketId)).toStrictEqual(['id-901', 'id-901', 'id-901']);
	});
});
