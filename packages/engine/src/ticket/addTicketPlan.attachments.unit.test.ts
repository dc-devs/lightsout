import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { addTicketPlan } from '#src/ticket/index.ts';
import type { TrackerAttachment, TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam mocked: what a ticket's attachments say
// about a plan published before ticket records existed decides whether a plan
// may be added here at all, and the folder and record are real files on disk.
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

		const apiKey = env[block['api-key-env']] ?? '';

		return apiKey === ''
			? { error: `the tracker API key is missing: set the \`${block['api-key-env']}\` environment variable` }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey };
	},
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch every row below names. */
const ticketBranch = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };

/** An empty ticket folder in a fresh checkout, with the tracker answering the given attachments. */
const setupAddPlan = ({ attachments }: { attachments: TrackerAttachment[] | TrackerFailure }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-add-plan-attachments-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);

	mkdirSync(ticketFolder, { recursive: true });
	mockGetTicketAttachments.mockResolvedValue(attachments);
	// Narrowed to the two fields a publish reads: the rest of a tracker's issue
	// shape would say nothing about this function.
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' } as TrackerTicket]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		recordPath: join(ticketFolder, 'ticket.json'),
		planFolderOf: ({ planId }: { planId: string }) => join(ticketFolder, 'plans', planId),
		params: { cwd, ticketBranch, slug: 'search-basics', config: { gates, 'ticket-tracker': trackerBlock }, env },
	};
};

/** The record as it stands on disk, which is what a later command reads. */
const recordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord;

describe('addTicketPlan attachments', () => {
	test('refuses when the ticket carries a plan published before ticket records and names ticket adopt', async () => {
		const { params, recordPath, planFolderOf } = setupAddPlan({
			attachments: [{ id: 'att-1', title: 'plan-attachments.json', url: 'https://assets.example.com/plan-attachments.json' }],
		});

		const result = await addTicketPlan(params);

		expect(result).toEqual({ error: expect.stringContaining('ticket adopt') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
		expect(mockSetTicketAttachment).not.toHaveBeenCalled();
	});

	test('adds plan 001 and publishes the record when the ticket carries attachments but no plan published before ticket records', async () => {
		// The refusal above turns on one attachment title, so the row that proves
		// it is not a blanket refusal on any attachment belongs beside it.
		const { params, recordPath, planFolderOf } = setupAddPlan({
			attachments: [{ id: 'att-1', title: 'design.md', url: 'https://assets.example.com/design.md' }],
		});

		const result = await addTicketPlan(params);

		expect(result).toStrictEqual({
			address: 'lo-140-multi/001-search-basics',
			record: expect.objectContaining({ plans: [expect.objectContaining({ id: '001-search-basics' })] }),
			notice: undefined,
			publishError: undefined,
		});
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-search-basics']);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(true);
		expect(mockSetTicketAttachment).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'id-140', title: 'ticket.json' }));
	});

	test("refuses when the ticket's attachments could not be read at all", async () => {
		// Unread attachments cannot say whether a plan was published here before
		// ticket records existed, so passing over the failure is what would let a
		// new plan 001 land on top of one. Adding a plan reads the ticket twice,
		// and both reads owe that refusal.
		const { params, recordPath, planFolderOf } = setupAddPlan({ attachments: { error: 'the tracker answered 503' } });

		const whileReadingTheRecord = await addTicketPlan(params);
		// One clean answer lets the record read through, so the call fails on the
		// read after it: the look for a plan published before ticket records.
		mockGetTicketAttachments.mockResolvedValueOnce([]);
		const whileLookingForALegacyPlan = await addTicketPlan(params);

		expect(whileReadingTheRecord).toEqual({ error: expect.stringContaining('ticket.json') });
		expect(whileReadingTheRecord).toEqual({ error: expect.stringContaining('503') });
		expect(whileLookingForALegacyPlan).toEqual({ error: expect.not.stringContaining('ticket.json') });
		expect(whileLookingForALegacyPlan).toEqual({ error: expect.stringContaining('503') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
	});
});
