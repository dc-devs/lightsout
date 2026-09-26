import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { appendCommandLog } from '#src/runState/appendCommandLog.ts';
import { RunNotFoundError } from '#src/runState/RunNotFoundError.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

interface SetupParams {
	/** A line already on the log, so appending-vs-rewriting is observable. */
	priorLine?: Record<string, unknown>;
}

const setupCommandLog = ({ priorLine }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const runId = 'run-commands';
	const logPath = join(runDirFor({ cwd, runId }), 'commands.jsonl');

	// A ledger goes in its run's own folder, which is looked up by id — so both
	// folders have to be on disk before anything can be appended to either.
	mkdirSync(dirname(logPath), { recursive: true });
	mkdirSync(runDirFor({ cwd, runId: 'other-run' }), { recursive: true });

	if (priorLine) {
		writeFileSync(logPath, `${JSON.stringify(priorLine)}\n`, 'utf8');
	}

	const readLines = () => readFileSync(logPath, 'utf8').trim().split('\n');
	const readLog = () => readLines().map((line) => JSON.parse(line) as Record<string, unknown>);

	return { cwd, runId, logPath, readLines, readLog };
};

describe('appendCommandLog', () => {
	test('writes one commands.jsonl line carrying the executed gate verbatim', async () => {
		const { cwd, runId, readLog } = setupCommandLog();

		await appendCommandLog({
			cwd,
			runId,
			record: {
				at: '2026-07-03T00:00:00.000Z',
				step: 'clean-slate',
				group: 'root',
				kind: 'test',
				command: 'pnpm test',
				exitCode: 0,
				durationMs: 1234,
			},
		});

		expect(readLog()).toStrictEqual([
			{
				at: '2026-07-03T00:00:00.000Z',
				step: 'clean-slate',
				group: 'root',
				kind: 'test',
				command: 'pnpm test',
				exitCode: 0,
				durationMs: 1234,
			},
		]);
	});

	test('creates the ledger file for a run that has written nothing yet', async () => {
		const { cwd, runId, logPath, readLog } = setupCommandLog();

		await appendCommandLog({
			cwd,
			runId,
			record: { at: '2026-07-03T00:00:00.000Z', group: 'root', kind: 'check', command: 'tsc --noEmit', exitCode: 0 },
		});

		// the folder is looked up rather than made, so the first append has to make
		// the ledger inside it: ${logPath}
		expect(existsSync(logPath)).toBeTruthy();
		expect(readLog()).toStrictEqual([{ at: '2026-07-03T00:00:00.000Z', group: 'root', kind: 'check', command: 'tsc --noEmit', exitCode: 0 }]);
	});

	test('refuses a run nothing ever created, rather than leaving a ledger where no reader looks', async () => {
		const { cwd } = setupCommandLog();

		await expect(
			appendCommandLog({
				cwd,
				runId: 'never-created',
				record: { at: '2026-07-03T00:00:00.000Z', group: 'root', kind: 'check', command: 'tsc --noEmit', exitCode: 0 },
			}),
		).rejects.toThrow(RunNotFoundError);

		// a run folder is filed under the work it belongs to, so an append that
		// joined one would write evidence into a folder nothing ever scans
		expect(existsSync(runDirFor({ cwd, runId: 'never-created' }))).toBe(false);
	});

	test('records a gate that never ran with its reason and no exit code', async () => {
		const { cwd, runId, readLog } = setupCommandLog();

		await appendCommandLog({
			cwd,
			runId,
			record: {
				at: '2026-07-03T00:00:00.000Z',
				group: 'root',
				kind: 'build',
				command: 'pnpm build',
				skipped: true,
				reason: 'no matching script',
			},
		});

		const [record] = readLog();

		expect(record).toStrictEqual({
			at: '2026-07-03T00:00:00.000Z',
			group: 'root',
			kind: 'build',
			command: 'pnpm build',
			skipped: true,
			reason: 'no matching script',
		});
		// a gate that never ran has no exit code to misread as a pass
		expect(Object.hasOwn(record, 'exitCode')).toBe(false);
	});

	test('keeps a failing gate on one line even when its output tail spans many', async () => {
		const { cwd, runId, readLines, readLog } = setupCommandLog();

		await appendCommandLog({
			cwd,
			runId,
			record: {
				at: '2026-07-03T00:00:00.000Z',
				group: 'root',
				kind: 'test',
				command: 'pnpm test',
				exitCode: 1,
				outputTail: 'FAIL first\nFAIL second\n',
			},
		});

		// a multi-line tail must not split the record across JSONL lines
		expect(readLines().length).toBe(1);
		expect(readLog()[0]?.outputTail).toBe('FAIL first\nFAIL second\n');
	});

	test('appends beside the lines a run already has instead of rewriting the log', async () => {
		const { cwd, runId, readLog } = setupCommandLog({
			priorLine: { at: '2026-07-03T00:00:00.000Z', group: 'root', kind: 'check', command: 'tsc --noEmit', exitCode: 0 },
		});

		await appendCommandLog({
			cwd,
			runId,
			record: { at: '2026-07-03T00:01:00.000Z', group: 'root', kind: 'test', command: 'pnpm test', exitCode: 0 },
		});

		const log = readLog();

		// every command leaves its own line: ${JSON.stringify(log)}
		expect(log.length).toBe(2);
		expect(log.map((record) => record.kind)).toStrictEqual(['check', 'test']);
	});

	test('keeps every run gate evidence in its own run directory', async () => {
		const { cwd, runId, readLog } = setupCommandLog();

		await appendCommandLog({
			cwd,
			runId,
			record: { at: '2026-07-03T00:00:00.000Z', group: 'root', kind: 'check', command: 'tsc --noEmit', exitCode: 0 },
		});
		await appendCommandLog({
			cwd,
			runId: 'other-run',
			record: { at: '2026-07-03T00:01:00.000Z', group: 'root', kind: 'check', command: 'tsc --noEmit', exitCode: 1 },
		});

		const log = readLog();
		const otherLog = readFileSync(join(runDirFor({ cwd, runId: 'other-run' }), 'commands.jsonl'), 'utf8').trim();

		// a gate from another run never lands on this ledger
		expect(log.length).toBe(1);
		expect((JSON.parse(otherLog) as Record<string, unknown>).exitCode).toBe(1);
	});
});
