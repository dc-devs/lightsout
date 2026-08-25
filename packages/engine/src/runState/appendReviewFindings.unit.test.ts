import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { appendReviewFindings, readReviewFindings } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: 'single-return',
	severity: StandardsSeverity.Advisory,
	siteKey: 'single-return:src/a.ts',
	files: [{ path: 'src/a.ts', startLine: 12 }],
	detail: 'six exits',
	...overrides,
});

interface SetupParams {
	/** A line an earlier run already logged, so appending-vs-rewriting is observable. */
	priorLine?: Record<string, unknown>;
}

const setupLedger = ({ priorLine }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const runId = 'run-review';
	const logPath = join(cwd, '.lightsout', 'review-findings.jsonl');

	if (priorLine) {
		mkdirSync(dirname(logPath), { recursive: true });
		writeFileSync(logPath, `${JSON.stringify(priorLine)}\n`, 'utf8');
	}

	const readLines = () => readFileSync(logPath, 'utf8').trim().split('\n');
	const readLog = () => readLines().map((line) => JSON.parse(line) as Record<string, unknown>);

	return { cwd, runId, logPath, readLines, readLog };
};

describe('appendReviewFindings', () => {
	test('writes one line carrying the finding the reviewer reported plus its provenance', async () => {
		const { cwd, runId, readLog } = setupLedger();

		await appendReviewFindings({ cwd, runId, step: 'batch-01:multi-export:src', findings: [finding()] });

		const [{ at, ...record }] = readLog();

		expect(record).toStrictEqual({
			rule: 'single-return',
			severity: 'advisory',
			siteKey: 'single-return:src/a.ts',
			files: [{ path: 'src/a.ts', startLine: 12 }],
			detail: 'six exits',
			runId: 'run-review',
			step: 'batch-01:multi-export:src',
		});
		// every entry is stamped with when the review saw it
		expect(String(at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});

	test('creates the log directory for a repo no review has ever read', async () => {
		const { cwd, runId, logPath } = setupLedger();

		await appendReviewFindings({ cwd, runId, step: 'batch-01', findings: [finding()] });

		// the log lands repo-wide at .lightsout/review-findings.jsonl, not under a
		// run directory: what a review keeps finding in one place is the signal,
		// and one run's view of it is not
		expect(existsSync(logPath)).toBeTruthy();
	});

	test('appends to what earlier runs logged rather than replacing it', async () => {
		const prior = {
			rule: 'duplicate-code-block',
			severity: 'advisory',
			siteKey: 'duplicate-code-block:src/old.ts',
			files: [{ path: 'src/old.ts' }],
			detail: 'a span',
			at: '2026-01-01T00:00:00.000Z',
			runId: 'run-earlier',
			step: 'batch-09',
		};
		const { cwd, runId, readLines } = setupLedger({ priorLine: prior });

		await appendReviewFindings({ cwd, runId, step: 'batch-01', findings: [finding()] });

		expect(readLines()).toHaveLength(2);
	});

	test('writes one line per finding, so a review that saw several is several records', async () => {
		const { cwd, runId, readLines } = setupLedger();

		await appendReviewFindings({
			cwd,
			runId,
			step: 'batch-01',
			findings: [finding(), finding({ rule: 'duplicate-code-block', siteKey: 'duplicate-code-block:src/b.ts', files: [{ path: 'src/b.ts' }] })],
		});

		expect(readLines()).toHaveLength(2);
	});

	test('a review that found nothing writes nothing — an empty log and no log are the same absence', async () => {
		const { cwd, runId, logPath } = setupLedger();

		await appendReviewFindings({ cwd, runId, step: 'batch-01', findings: [] });

		expect(existsSync(logPath)).toBe(false);
	});
});

describe('readReviewFindings', () => {
	test('reads back what the reviews of this repo have logged, oldest first', async () => {
		const { cwd, runId } = setupLedger();

		await appendReviewFindings({ cwd, runId, step: 'batch-01', findings: [finding()] });
		await appendReviewFindings({
			cwd,
			runId: 'run-later',
			step: 'batch-02',
			findings: [finding({ rule: 'duplicate-code-block', siteKey: 'duplicate-code-block:src/b.ts' })],
		});

		const records = await readReviewFindings({ cwd });

		expect(records.map((entry) => entry.rule)).toStrictEqual(['single-return', 'duplicate-code-block']);
		expect(records[1]?.runId).toBe('run-later');
	});

	test('a repo no review has ever read reads back as an empty log, not an error', async () => {
		const { cwd } = setupLedger();

		expect(await readReviewFindings({ cwd })).toStrictEqual([]);
	});

	test('a malformed line is skipped rather than guessed at', async () => {
		const { cwd, runId } = setupLedger({ priorLine: { rule: 'duplicate-code-block', detail: 'no site key, no files' } });

		await appendReviewFindings({ cwd, runId, step: 'batch-01', findings: [finding()] });
		const records = await readReviewFindings({ cwd });

		// a line the contract cannot read is not a finding, and inventing the
		// missing halves would put a site nobody reported into the account
		expect(records.map((entry) => entry.rule)).toStrictEqual(['single-return']);
	});
});
