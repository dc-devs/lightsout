import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerAttachment, TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { addWorkOrderPlan } from '#src/workOrder/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam mocked: what a ticket's attachments say
// is what a record pull reads before a plan may be added here at all, and the
// folder and record are real files on disk.
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

/** The work order's label, which is also the branch every row below names. */
const name = 'lo-140-multi';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const trackerBlock: LightsoutConfig['ticket-tracker'] = { ...ticketTrackerConfigBlock, provider: 'linear' };
const env = { LINEAR_API_KEY: 'lin_key' };

/** An empty work order folder in a fresh checkout, with the tracker answering the given attachments. */
const setupAddPlan = ({ attachments }: { attachments: TrackerAttachment[] | TrackerFailure }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-add-plan-attachments-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);

	mkdirSync(workOrderFolder, { recursive: true });
	mockGetTicketAttachments.mockResolvedValue(attachments);
	// Narrowed to the two fields a publish reads: the rest of a tracker's issue
	// shape would say nothing about this function.
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-140', identifier: 'LO-140' } as TrackerTicket]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		recordPath: join(workOrderFolder, 'state.json'),
		planFolderOf: ({ planId }: { planId: string }) => join(workOrderFolder, 'plans', planId),
		params: { cwd, name, slug: 'search-basics', config: { gates, 'ticket-tracker': trackerBlock }, env },
	};
};

/** The record as it stands on disk, which is what a later command reads. */
const recordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState;

describe('addWorkOrderPlan attachments', () => {
	test('adds plan 001 to a ticket carrying a plan published before work order states', async () => {
		// Such a plan can never become this ticket's plan 001 now, so refusing the
		// add would strand the ticket with no remedy to name. Publishing is per
		// plan id, so a fresh plan 001 collides with nothing.
		const { params, recordPath, planFolderOf } = setupAddPlan({
			attachments: [{ id: 'att-1', title: 'plan-attachments.json', url: 'https://assets.example.com/plan-attachments.json' }],
		});

		const result = await addWorkOrderPlan(params);

		expect(result).toStrictEqual({
			address: 'lo-140-multi/001-search-basics',
			record: expect.objectContaining({ plans: [expect.objectContaining({ id: '001-search-basics' })] }),
			notice: undefined,
			publishError: undefined,
		});
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-search-basics']);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(true);
		expect(mockSetTicketAttachment).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'id-140', title: 'state.json' }));
	});

	test('adds plan 001 and publishes the record when the ticket carries attachments but no plan published before work order states', async () => {
		// The row above carries the one attachment title that used to decide this,
		// so the row proving an ordinary attachment changes nothing sits beside it.
		const { params, recordPath, planFolderOf } = setupAddPlan({
			attachments: [{ id: 'att-1', title: 'design.md', url: 'https://assets.example.com/design.md' }],
		});

		const result = await addWorkOrderPlan(params);

		expect(result).toStrictEqual({
			address: 'lo-140-multi/001-search-basics',
			record: expect.objectContaining({ plans: [expect.objectContaining({ id: '001-search-basics' })] }),
			notice: undefined,
			publishError: undefined,
		});
		expect(recordAt({ recordPath }).plans.map((plan) => plan.id)).toStrictEqual(['001-search-basics']);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(true);
		expect(mockSetTicketAttachment).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'id-140', title: 'state.json' }));
	});

	test("refuses when the ticket's attachments could not be read at all", async () => {
		// Unread attachments cannot say whether the ticket already carries a record,
		// so passing over the failure is what would let a second plan 001 land on
		// top of one this machine has never seen.
		const { params, recordPath, planFolderOf } = setupAddPlan({ attachments: { error: 'the tracker answered 503' } });

		const whileReadingTheRecord = await addWorkOrderPlan(params);

		expect(whileReadingTheRecord).toEqual({ error: expect.stringContaining('state.json') });
		expect(whileReadingTheRecord).toEqual({ error: expect.stringContaining('503') });
		expect(existsSync(recordPath)).toBe(false);
		expect(existsSync(planFolderOf({ planId: '001-search-basics' }))).toBe(false);
	});
});
