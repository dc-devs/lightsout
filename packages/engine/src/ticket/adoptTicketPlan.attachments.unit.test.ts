import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { adoptTicketPlan } from '#src/ticket/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { attachmentMarkerText } from '#tests/helpers/attachmentMarkerText.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam: what the ticket's attachments say is the
// only thing an adoption can fall back on when the checkout holds no folder of
// its own, and the files it then writes are real files in a temporary checkout.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<{ id: string; identifier: string }[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ env: processEnv }: { env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => ({
		provider: 'linear',
		ticketPrefix: 'LO',
		team: 'LO',
		apiKey: processEnv.LINEAR_API_KEY ?? '',
	}),
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

const ticketBranch = 'lo-9-adopt';
const slug = 'search-basics';
const planId = '001-search-basics';
const address = `${ticketBranch}/${planId}`;
const config: LightsoutConfig = {
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'ticket-tracker': { ...ticketTrackerConfigBlock, provider: 'linear' },
};
const env = { LINEAR_API_KEY: 'lin_key' };

const planBody = '# the single-folder plan of lo-9\n';
const notesBody = '# brainstorm notes of lo-9\n';

/** The bare-title plan and brainstorm generations a ticket shaped before ticket records carries. */
const bareGenerations = (() => {
	const planFiles = { 'plan.md': planBody };
	const brainstormFiles = { 'brainstorm-notes.md': notesBody, 'brainstorm-decisions.json': '{\n\t"decisions": []\n}\n' };

	return {
		...planFiles,
		...brainstormFiles,
		'plan-attachments.json': attachmentMarkerText({ files: planFiles }),
		'brainstorm-attachments.json': attachmentMarkerText({ files: brainstormFiles }),
	};
})();

/**
 * A temporary checkout belonging to no repository, holding an empty plans
 * folder, beside a ticket carrying the attachments the row names. Nothing local
 * is left to adopt, so the ticket is the only place the plan can come from.
 */
const setupBareTicket = ({ attachments }: { attachments: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-adopt-ticket-attachments-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);
	const titles = Object.keys(attachments);

	mkdirSync(join(ticketFolder, 'plans'), { recursive: true });

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => attachments[titles[Number(url.split('/').at(-1))] ?? ''] ?? '');
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'ticket-1', identifier: 'lo-9' }]);
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return { cwd, ticketFolder, plansFolder: join(ticketFolder, 'plans'), planFolder: join(ticketFolder, 'plans', planId) };
};

/** Adopt, and hand back the two sides of the answer already told apart. */
const adopt = async ({ cwd }: { cwd: string }) => {
	const result = await adoptTicketPlan({ cwd, ticketBranch, slug, config, env });

	return { change: 'error' in result ? undefined : result, error: 'error' in result ? result.error : undefined };
};

/** A directory's sorted entries, or undefined when it was never created. */
const entriesOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

/** The record's bytes as they are on disk, or undefined when no record was written. */
const recordTextOf = ({ ticketFolder }: { ticketFolder: string }) => {
	try {
		return readFileSync(join(ticketFolder, 'ticket.json'), 'utf8');
	} catch {
		return undefined;
	}
};

/** The one plan the record holds after an adoption. */
const planEntryOf = ({ ticketFolder }: { ticketFolder: string }) => {
	const text = recordTextOf({ ticketFolder });

	return text === undefined ? undefined : (JSON.parse(text) as TicketRecord).plans.at(0);
};

describe('adoptTicketPlan', () => {
	test('refuses a folder with no legacy files to adopt', async () => {
		const { cwd, ticketFolder, planFolder } = setupBareTicket({ attachments: {} });

		const { change, error } = await adopt({ cwd });

		expect(error).toEqual(expect.any(String));
		expect({ change, moved: entriesOf({ dir: planFolder }), record: recordTextOf({ ticketFolder }) }).toStrictEqual({
			change: undefined,
			moved: undefined,
			record: undefined,
		});
	});

	test("restores the ticket's bare-title generations first when the primary checkout holds no legacy folder", async () => {
		const { cwd, ticketFolder, plansFolder, planFolder } = setupBareTicket({ attachments: bareGenerations });

		const { change, error } = await adopt({ cwd });

		expect({ error, address: change?.address }).toStrictEqual({ error: undefined, address });
		expect({ topLevel: entriesOf({ dir: plansFolder }), moved: entriesOf({ dir: planFolder }) }).toStrictEqual({
			topLevel: [planId],
			moved: ['brainstorm-decisions.json', 'brainstorm-notes.md', 'plan.md'],
		});
		expect(planEntryOf({ ticketFolder })).toEqual(expect.objectContaining({ id: planId, progress: 'ready' }));
	});
});
