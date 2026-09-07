import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { appendTestReview } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

interface SetupParams {
	/** A review an earlier checkpoint already journalled, so appending-vs-rewriting is observable. */
	priorLine?: Record<string, unknown>;
}

const setupJournal = ({ priorLine }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const runId = 'run-test-review';
	const journalPath = join(cwd, '.lightsout', 'runs', runId, 'test-reviews.jsonl');

	if (priorLine) {
		mkdirSync(dirname(journalPath), { recursive: true });
		writeFileSync(journalPath, `${JSON.stringify(priorLine)}\n`, 'utf8');
	}

	const readLines = () => readFileSync(journalPath, 'utf8').trim().split('\n');
	const readJournal = () => readLines().map((line) => JSON.parse(line) as Record<string, unknown>);

	return { cwd, runId, journalPath, readLines, readJournal };
};

describe('appendTestReview', () => {
	test("appendTestReview: each review is one JSON line in the run's review journal", async () => {
		const { cwd, runId, readLines, readJournal } = setupJournal({
			priorLine: {
				checkpoint: 'verify-implement',
				at: '2026-07-03T00:00:00.000Z',
				verdicts: [{ path: 'src/a.unit.test.ts', decision: 'approve', reason: 'stale import after the move', acceptanceTests: [] }],
				rejections: [],
			},
		});

		await appendTestReview({
			cwd,
			runId,
			record: {
				checkpoint: 'verify-tests',
				at: '2026-07-03T00:01:00.000Z',
				verdicts: [
					{
						path: 'src/b.unit.test.ts',
						decision: 'reject',
						reason: 'the assertion was weakened,\nand the subject is mocked away',
						acceptanceTests: [{ testName: 'b: holds', disposition: 'kept' }],
					},
				],
				rejections: ['src/b.unit.test.ts: the assertion was weakened'],
			},
		});

		const journal = readJournal();

		// a multi-line reason must not split one review across journal lines,
		// and the earlier checkpoint's review must still be there
		expect(readLines()).toHaveLength(2);
		expect(journal[0]?.checkpoint).toBe('verify-implement');
		expect(journal[1]).toStrictEqual({
			checkpoint: 'verify-tests',
			at: '2026-07-03T00:01:00.000Z',
			verdicts: [
				{
					path: 'src/b.unit.test.ts',
					decision: 'reject',
					reason: 'the assertion was weakened,\nand the subject is mocked away',
					acceptanceTests: [{ testName: 'b: holds', disposition: 'kept' }],
				},
			],
			rejections: ['src/b.unit.test.ts: the assertion was weakened'],
		});
	});
});
