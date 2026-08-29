import { describe, expect, jest, test } from '@jest/globals';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { appendTicketNote } from '#src/queue/tracker/index.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it lets these
// tests read the body that would be written back, which is the whole behaviour.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/queue/tracker/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings: QueueSettings = {
	team: 'LO',
	routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	maxParallel: 1,
	apiKey: 'lin_key',
	eligibleStatuses: ['Backlog'],
	inProgressStatus: 'In Progress',
	branchTemplate: '{ticket}-{slug}',
	decisionsHeading: '## Decisions',
	workerMinutes: 240,
};

/** Write the note against this body and answer the body the tracker would end up holding. A body of undefined is a ticket the tracker holds no description for. */
const writtenBody = async ({ body, heading = '## Decisions', line = '- Which one? → the second' }: { body?: string; heading?: string; line?: string }) => {
	let written = '';

	mockRunLinear.mockImplementation(({ call }) =>
		call({
			issue: () => Promise.resolve({ description: body }),
			updateIssue: (_id: string, input: { description: string }) => {
				written = input.description;

				return Promise.resolve({ success: true });
			},
		}),
	);

	await appendTicketNote({ settings, ticketId: 'id-70', heading, line });

	return written;
};

describe('appendTicketNote', () => {
	test('writes the line as the last line of the named section', async () => {
		const body = await writtenBody({ body: '# Ticket\n\n## Decisions\n\n- Something earlier → yes\n\n## Notes\n\nlater prose\n' });

		expect(body).toBe('# Ticket\n\n## Decisions\n\n- Something earlier → yes\n- Which one? → the second\n\n## Notes\n\nlater prose\n');
	});

	test('creates the section at the end when the ticket has none, rather than dropping the answer', async () => {
		const body = await writtenBody({ body: '# Ticket\n\nsome prose\n' });

		expect(body).toBe('# Ticket\n\nsome prose\n\n## Decisions\n\n- Which one? → the second\n');
	});

	test('starts the section from nothing when the ticket has no body at all', async () => {
		const body = await writtenBody({ body: '' });

		expect(body).toBe('## Decisions\n\n- Which one? → the second\n');
	});

	test('starts the section from nothing when the tracker holds no description at all', async () => {
		const body = await writtenBody({ body: undefined });

		expect(body).toBe('## Decisions\n\n- Which one? → the second\n');
	});

	test('writes under a heading that is not markdown at all, because the heading is whatever the repo configured', async () => {
		const body = await writtenBody({ body: 'Decisions\n\n- first → yes\n\n## Notes\n\nlater prose\n', heading: 'Decisions' });

		expect(body).toBe('Decisions\n\n- first → yes\n- Which one? → the second\n\n## Notes\n\nlater prose\n');
	});

	test('leaves an identical line alone, so a re-run never doubles a decision', async () => {
		const existing = '## Decisions\n\n- Which one? → the second\n';

		expect(await writtenBody({ body: existing })).toBe(existing);
	});

	test('stops at the next heading of the same level, never spilling the line into the section below', async () => {
		const body = await writtenBody({ body: '## Decisions\n\n- first → yes\n\n## Open questions\n\n- what about x?\n' });

		expect(body).toBe('## Decisions\n\n- first → yes\n- Which one? → the second\n\n## Open questions\n\n- what about x?\n');
	});

	test('reads deeper headings as part of the section, because a sub-heading does not end it', async () => {
		const body = await writtenBody({ body: '## Decisions\n\n### Rejected\n\n- the other one\n\n## Notes\n' });

		expect(body).toBe('## Decisions\n\n### Rejected\n\n- the other one\n- Which one? → the second\n\n## Notes\n');
	});

	test('writes under whatever heading the repo configured, because the heading is a tracker convention', async () => {
		const body = await writtenBody({ body: '# Ticket\n\n## Settled\n\n- first → yes\n', heading: '## Settled' });

		expect(body).toBe('# Ticket\n\n## Settled\n\n- first → yes\n- Which one? → the second\n');
	});

	test('hands a tracker failure back untouched', async () => {
		mockRunLinear.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await appendTicketNote({ settings, ticketId: 'id-70', heading: '## Decisions', line: '- a → b' })).toStrictEqual({
			error: 'the tracker did not answer',
		});
	});
});
