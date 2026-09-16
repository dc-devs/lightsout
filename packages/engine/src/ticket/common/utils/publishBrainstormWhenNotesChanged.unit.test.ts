import { describe, expect, jest, test } from '@jest/globals';

// Dependencies
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { publishBrainstormWhenNotesChanged } from '#src/ticket/common/utils/publishBrainstormWhenNotesChanged.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
const mockAttachments = jest.fn<() => Promise<Array<{ id: string; title: string; url: string }>>>();
const mockRead = jest.fn<(params: { url: string }) => Promise<string>>();
const mockSet = jest.fn<(params: { title: string; content: Buffer }) => Promise<undefined>>();
jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: async () => [{ id: 'ticket-144', identifier: 'LO-144' }],
	getTicketAttachments: () => mockAttachments(),
	readTicketAsset: (params: { url: string }) => mockRead(params),
	setTicketAttachment: (params: { title: string; content: Buffer }) => mockSet(params),
	resolveTrackerSettings: () => trackerSettingsFixture(),
}));

const setup = async ({ corrupt }: { corrupt: boolean }) => {
	const fixture = await planningAlignedFixture({ name: 'lo-144-handoff/001-plan' });
	const assets = new Map([...fixture.files].map(([name, text]) => [`001-plan--${name}`, text]));
	assets.set(
		'001-plan--brainstorm-attachments.json',
		serializeAttachmentManifest({
			files: [...fixture.files].map(([name, text]) => ({ name, content: Buffer.from(text) })),
			brainstormGeneration: fixture.snapshot.digest,
		}).toString(),
	);
	if (corrupt) assets.set('001-plan--brainstorm-decisions.json', '{}');
	else assets.delete('001-plan--brainstorm-record.json');
	const written: string[] = [];
	mockAttachments.mockImplementation(async () => [...assets.keys()].map((title) => ({ id: title, title, url: title })));
	mockRead.mockImplementation(async ({ url }) => assets.get(url) ?? '');
	mockSet.mockImplementation(async ({ title, content }) => {
		assets.set(title, content.toString());
		written.push(title);
		return undefined;
	});
	return {
		...fixture,
		assets,
		written,
		params: {
			cwd: fixture.cwd,
			address: fixture.name,
			planId: '001-plan',
			config: fixture.runtime.config,
			env: {},
			target: { settings: trackerSettingsFixture(), ticketRef: 'LO-144' },
		},
	};
};

describe('publishBrainstormWhenNotesChanged', () => {
	test.each([false, true])('repairs incomplete canonical assets even when the original notes hash matches (corrupt decisions: %s)', async (corrupt) => {
		const fixture = await setup({ corrupt });

		const report = await publishBrainstormWhenNotesChanged(fixture.params);

		expect(report).not.toHaveProperty('error');
		for (const [name, text] of fixture.files) expect(fixture.assets.get(`001-plan--${name}`)).toBe(text);
		expect(fixture.written.at(-1)).toBe('001-plan--brainstorm-attachments.json');
		expect(fixture.written).toContain('001-plan--brainstorm-record.json');
	});
});
