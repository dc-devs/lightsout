import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker write is the only part of an answer that leaves the machine. The
// decisions file is real, because where the queue records Q&A is the behaviour
// under test.
const mockAppendTicketNote =
	jest.fn<(params: { settings: QueueSettings; ticketId: string; heading: string; line: string }) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/tracker/index.ts', () => ({
	appendTicketNote: (params: { settings: QueueSettings; ticketId: string; heading: string; line: string }) => mockAppendTicketNote(params),
}));
// -------------------------

const settings = queueSettingsFixture();

const ticketOf = (overrides: Partial<TicketSummary> = {}): TicketSummary => ({
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	route: QueueRoute.Direct,
	unfinishedBlockers: [],
	...overrides,
});

/**
 * A relay wired to a pair of streams, typing the next queued answer whenever a
 * prompt appears. Driven by the prompt rather than by a timer, so nothing here
 * depends on how long a disk write happens to take.
 */
const setupRelay = ({ answers = [], atPrompt }: { answers?: string[]; atPrompt?: () => void } = {}) => {
	const input = new PassThrough();
	const written: string[] = [];
	const queued = [...answers];
	// Collected as it is written rather than through a data event, so an
	// assertion never races the stream it is reading.
	const output = new Writable({
		write(chunk: Buffer, _encoding, done) {
			written.push(chunk.toString());

			if (chunk.toString().includes('answer: ')) {
				atPrompt?.();

				const next = queued.shift();

				if (next !== undefined) {
					setImmediate(() => input.write(`${next}\n`));
				}
			}

			done();
		},
	});

	mockAppendTicketNote.mockResolvedValue(undefined);

	const relay = new TerminalQuestionRelay({ settings, input, output });
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-relay-'));

	return { relay, input, coordinatorRunDir, terminal: () => written.join('') };
};

/** Every record the coordinator run's decisions file holds. */
const readDecisions = ({ coordinatorRunDir }: { coordinatorRunDir: string }) =>
	readFileSync(join(coordinatorRunDir, 'decisions.jsonl'), 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);

describe('TerminalQuestionRelay', () => {
	test('puts the ticket, its title and the question to the terminal, and answers with what was typed', async () => {
		const { relay, coordinatorRunDir, terminal } = setupRelay({ answers: ['  the second one  '] });

		const given = await relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir });

		relay.close();

		expect(given).toBe('the second one');
		expect(terminal()).toContain('LO-70 Drain the backlog');
		expect(terminal()).toContain('Which one?');
	});

	test('keeps the answer in the coordinator run’s decisions file, tagged with the ticket it belongs to', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['the second one'] });

		await relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir });
		relay.close();

		expect(readDecisions({ coordinatorRunDir })).toEqual([
			expect.objectContaining({ question: 'Which one?', answer: 'the second one', ticket: 'LO-70', runId: 'run-q', step: 'queue-question' }),
		]);
	});

	test('writes the answer onto the ticket under the heading the repo configured', async () => {
		const { relay, coordinatorRunDir } = setupRelay({ answers: ['the second one'] });

		await relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir });
		relay.close();

		expect(mockAppendTicketNote).toHaveBeenCalledWith({ settings, ticketId: 'id-70', heading: '## Decisions', line: '- Which one? → the second one' });
	});

	test('warns rather than failing when the ticket copy cannot be written — the answer is already on the worker’s disk', async () => {
		const { relay, coordinatorRunDir, terminal } = setupRelay({ answers: ['the second one'] });

		mockAppendTicketNote.mockResolvedValue({ error: 'the tracker did not answer' });

		const given = await relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir });

		relay.close();

		expect(given).toBe('the second one');
		expect(terminal()).toContain('could not be written to the ticket');
	});

	test('asks again on a bare enter, so an accidental keystroke never sends a blank answer to a worker that will act on it', async () => {
		const { relay, coordinatorRunDir, terminal } = setupRelay({ answers: ['', 'the second one'] });

		const given = await relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir });

		relay.close();

		expect(given).toBe('the second one');
		expect(terminal().match(/answer: /g)?.length).toBeGreaterThanOrEqual(2);
	});

	test('serializes two workers’ questions, so the terminal never holds two half-written prompts', async () => {
		const { relay, coordinatorRunDir, terminal } = setupRelay({ answers: ['first answer', 'second answer'] });

		const [first, second] = await Promise.all([
			relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir }),
			relay.ask({ question: 'And the other?', ticket: ticketOf({ id: 'id-71', identifier: 'LO-71' }), coordinatorRunId: 'run-q', coordinatorRunDir }),
		]);

		relay.close();

		expect([first, second]).toStrictEqual(['first answer', 'second answer']);
		expect(terminal().indexOf('Which one?')).toBeLessThan(terminal().indexOf('And the other?'));
	});

	test('holds another worker’s progress while a question is open, then lets it through — a buried question defeats the one terminal', async () => {
		let heldWhilePrompting = false;
		const relayBox: { sink?: (message: string) => void; terminal?: () => string } = {};

		const { relay, coordinatorRunDir, terminal } = setupRelay({
			answers: ['the second one'],
			atPrompt: () => {
				relayBox.sink?.('verify: running the gates');
				heldWhilePrompting = relayBox.terminal?.().includes('verify: running the gates') === false;
			},
		});

		relayBox.sink = relay.createProgressSink({ ticket: ticketOf({ id: 'id-71', identifier: 'LO-71' }) });
		relayBox.terminal = terminal;

		await relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir });
		relay.close();

		expect(heldWhilePrompting).toBe(true);
		expect(terminal()).toContain('LO-71 · verify: running the gates');
		expect(terminal().indexOf('Which one?')).toBeLessThan(terminal().indexOf('verify: running the gates'));
	});

	test('prefixes every progress line with its ticket, so parallel workers stay readable in one window', () => {
		const { relay, terminal } = setupRelay();

		relay.createProgressSink({ ticket: ticketOf() })('implement — building LO-70');
		relay.close();

		expect(terminal()).toBe('LO-70 · implement — building LO-70\n');
	});

	test('refuses to wait on a terminal that is not there, so one unanswerable ticket cannot hang the whole drain', async () => {
		const { relay, input, coordinatorRunDir } = setupRelay({ atPrompt: () => input.end() });

		await expect(relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir })).rejects.toThrow(
			'there is no terminal to answer on',
		);
	});

	test('refuses immediately once the input has already ended, rather than printing a prompt nobody can answer', async () => {
		const { relay, input, coordinatorRunDir } = setupRelay();

		input.end();
		await new Promise((resolve) => setTimeout(resolve, 10));

		await expect(relay.ask({ question: 'Which one?', ticket: ticketOf(), coordinatorRunId: 'run-q', coordinatorRunDir })).rejects.toThrow(
			'there is no terminal to answer on',
		);
	});
});
