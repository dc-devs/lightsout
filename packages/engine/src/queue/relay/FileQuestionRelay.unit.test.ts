import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { RelayQuestion } from '#src/contracts/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { FileQuestionRelay } from '#src/queue/relay/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker write is the only part of an answer that leaves the machine. The
// mailbox and the decisions file are real, because what the relay puts on disk
// is the behaviour under test.
type NoteParams = { settings: QueueSettings; ticketId: string; heading: string; line: string };

const mockAppendTicketNote = jest.fn<(params: NoteParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/tracker/index.ts', () => ({ appendTicketNote: (params: NoteParams) => mockAppendTicketNote(params) }));
// -------------------------

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	route: QueueRoute.Direct,
	unfinishedBlockers: [],
};

/** A relay over a throwaway mailbox, kept apart from the coordinator run directory it records into. */
const setupRelay = ({ questionTimeoutMs = 30_000 }: { questionTimeoutMs?: number } = {}) => {
	const directory = mkdtempSync(join(tmpdir(), 'lightsout-mailbox-'));
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-relay-run-'));
	const written: string[] = [];
	const output = new Writable({
		write(chunk: Buffer, _encoding, done) {
			written.push(chunk.toString());
			done();
		},
	});

	mockAppendTicketNote.mockResolvedValue(undefined);

	const relay = new FileQuestionRelay({ settings: queueSettingsFixture({ questionTimeoutMs }), directory, output });
	const ask = () => relay.ask({ question: 'Which one?', ticket, coordinatorRunId: 'run-q', coordinatorRunDir });

	return { relay, ask, directory, coordinatorRunDir, output: () => written.join('') };
};

/** Wait for the relay to put a named file in the mailbox, so a test never races the write it is about to answer. */
const waitForFile = async ({ path }: { path: string }) => {
	for (let attempt = 0; attempt < 600; attempt += 1) {
		if (existsSync(path)) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	throw new Error(`${path} never appeared`);
};

describe('FileQuestionRelay', () => {
	test('answers with what the mailbox holds, trimmed, and clears both files behind it', async () => {
		const { ask, directory } = setupRelay();

		writeFileSync(join(directory, 'lo-70-1.answer.json'), JSON.stringify({ answer: '  the second one  ' }), 'utf8');

		expect(await ask()).toBe('the second one');
		expect(readdirSync(directory)).toStrictEqual([]);
	});

	test('records the answer before the worker sees it, on disk and on the ticket', async () => {
		const { ask, directory, coordinatorRunDir } = setupRelay();

		writeFileSync(join(directory, 'lo-70-1.answer.json'), JSON.stringify({ answer: 'the second one' }), 'utf8');
		await ask();

		expect(readFileSync(join(coordinatorRunDir, 'decisions.jsonl'), 'utf8')).toContain('"answer":"the second one"');
		expect(mockAppendTicketNote).toHaveBeenCalledWith({
			settings: queueSettingsFixture({ questionTimeoutMs: 30_000 }),
			ticketId: 'id-70',
			heading: '## Decisions',
			line: '- Which one? → the second one',
		});
	});

	test('writes a question file naming the ticket, its title and when it was asked — everything a reader needs is in the file', async () => {
		const { ask, directory, output } = setupRelay();
		const questionPath = join(directory, 'lo-70-1.question.json');
		const answered = ask();

		await waitForFile({ path: questionPath });

		const question = RelayQuestion.parse(JSON.parse(readFileSync(questionPath, 'utf8')));

		writeFileSync(join(directory, 'lo-70-1.answer.json'), JSON.stringify({ answer: 'the second one' }), 'utf8');

		expect(await answered).toBe('the second one');
		expect(question).toMatchObject({ ticket: 'LO-70', title: 'Drain the backlog', question: 'Which one?' });
		expect(Number.isNaN(Date.parse(question.askedAt))).toBe(false);
		expect(output()).toContain(`LO-70 · waiting for an answer in ${questionPath}`);
	});

	test('keeps a second question for the same ticket apart from the first, so neither overwrites the other', async () => {
		const { ask, directory } = setupRelay();

		writeFileSync(join(directory, 'lo-70-1.answer.json'), JSON.stringify({ answer: 'first' }), 'utf8');
		writeFileSync(join(directory, 'lo-70-2.answer.json'), JSON.stringify({ answer: 'second' }), 'utf8');

		expect(await ask()).toBe('first');
		expect(await ask()).toBe('second');
	});

	test('treats a half-written answer file as not yet answered, so a race never costs a ticket', async () => {
		const { ask, directory } = setupRelay();
		const answerPath = join(directory, 'lo-70-1.answer.json');

		writeFileSync(answerPath, '{"answ', 'utf8');

		const answered = ask();

		await waitForFile({ path: join(directory, 'lo-70-1.question.json') });
		writeFileSync(answerPath, JSON.stringify({ answer: 'the second one' }), 'utf8');

		expect(await answered).toBe('the second one');
	});

	test('treats a blank answer as no answer, because a worker would act on it', async () => {
		const { ask, directory } = setupRelay({ questionTimeoutMs: 1 });

		writeFileSync(join(directory, 'lo-70-1.answer.json'), JSON.stringify({ answer: '   ' }), 'utf8');

		await expect(ask()).rejects.toThrow('no answer arrived within 1ms for: Which one?');
	});

	test('takes both files with it when the question times out, so nothing left behind reads as live', async () => {
		const { ask, directory } = setupRelay({ questionTimeoutMs: 1 });

		writeFileSync(join(directory, 'lo-70-1.answer.json'), JSON.stringify({ answer: '' }), 'utf8');
		await expect(ask()).rejects.toThrow('no answer arrived');

		expect(readdirSync(directory)).toStrictEqual([]);
	});

	test('refuses a question once it is closed, rather than writing one into a mailbox nobody is reading', async () => {
		const { relay, ask } = setupRelay();

		relay.close();

		await expect(ask()).rejects.toThrow('the question relay is closed — no answer can arrive');
	});

	test('ends a wait already in flight when the relay closes, so a drain on its way out never hangs', async () => {
		const { relay, ask, directory } = setupRelay();
		const answered = ask();

		await waitForFile({ path: join(directory, 'lo-70-1.question.json') });
		relay.close();

		await expect(answered).rejects.toThrow('the question relay is closed — no answer can arrive');
	});

	test('prefixes every progress line with its ticket, so parallel workers stay readable in one window', () => {
		const { relay, output } = setupRelay();

		relay.createProgressSink({ ticket })('implement — building LO-70');

		expect(output()).toBe('LO-70 · implement — building LO-70\n');
	});
});
