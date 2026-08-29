import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { recordRelayedAnswer } from '#src/queue/relay/recordRelayedAnswer.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker write is the only part of an answer that leaves the machine. The
// decisions file is real, because where the queue records Q&A is the behaviour
// under test.
type NoteParams = { settings: QueueSettings; ticketId: string; heading: string; line: string };

const mockAppendTicketNote = jest.fn<(params: NoteParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/tracker/index.ts', () => ({ appendTicketNote: (params: NoteParams) => mockAppendTicketNote(params) }));
// -------------------------

const settings = queueSettingsFixture();

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	route: QueueRoute.Direct,
};

const setupRecording = () => {
	const progress: string[] = [];
	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-record-'));

	mockAppendTicketNote.mockResolvedValue(undefined);

	const record = () =>
		recordRelayedAnswer({
			settings,
			question: 'Which one?',
			answer: 'the second one',
			ticket,
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			onProgress: (message: string) => progress.push(message),
		});

	return { record, progress, coordinatorRunDir };
};

/** Every record the coordinator run's decisions file holds. */
const readDecisions = ({ coordinatorRunDir }: { coordinatorRunDir: string }) =>
	readFileSync(join(coordinatorRunDir, 'decisions.jsonl'), 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);

describe('recordRelayedAnswer', () => {
	test('keeps the answer in the coordinator run’s decisions file, tagged with the ticket it belongs to', async () => {
		const { record, coordinatorRunDir } = setupRecording();

		await record();

		expect(readDecisions({ coordinatorRunDir })).toEqual([
			expect.objectContaining({ question: 'Which one?', answer: 'the second one', ticket: 'LO-70', runId: 'run-q', step: 'queue-question' }),
		]);
	});

	test('writes the answer onto the ticket under the heading the repo configured', async () => {
		const { record } = setupRecording();

		await record();

		expect(mockAppendTicketNote).toHaveBeenCalledWith({ settings, ticketId: 'id-70', heading: '## Decisions', line: '- Which one? → the second one' });
	});

	test('reports rather than throwing when the ticket copy cannot be written — the answer is already on the worker’s disk', async () => {
		const { record, progress } = setupRecording();

		mockAppendTicketNote.mockResolvedValue({ error: 'the tracker did not answer' });

		await expect(record()).resolves.toBeUndefined();

		expect(progress).toStrictEqual(['the answer could not be written to the ticket: the tracker did not answer']);
	});
});
