import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import type { FrictionEntry } from '@/contracts';
import { appendFriction } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

interface SetupParams {
	/** A record an earlier run already logged, so appending-vs-rewriting is observable. */
	priorLine?: Record<string, unknown>;
}

const setupFrictionLog = ({ priorLine }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const runId = 'run-friction';
	const logPath = join(cwd, '.lightsout', 'friction.jsonl');

	if (priorLine) {
		mkdirSync(dirname(logPath), { recursive: true });
		writeFileSync(logPath, `${JSON.stringify(priorLine)}\n`, 'utf8');
	}

	const readLines = () => readFileSync(logPath, 'utf8').trim().split('\n');
	const readLog = () => readLines().map((line) => JSON.parse(line) as Record<string, unknown>);

	return { cwd, runId, logPath, readLines, readLog };
};

describe('appendFriction', () => {
	test('writes one friction.jsonl line carrying the reported entry plus its provenance', async () => {
		const { cwd, runId, readLog } = setupFrictionLog();

		await appendFriction({
			cwd,
			runId,
			step: 'write-tests',
			friction: [{ kind: 'friction', area: 'environment', detail: 'no jest config in the package' }],
		});

		const [{ at, ...record }] = readLog();

		assert.deepEqual(record, {
			kind: 'friction',
			area: 'environment',
			detail: 'no jest config in the package',
			runId: 'run-friction',
			step: 'write-tests',
		});
		assert.match(String(at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'every entry is stamped with when it was reported');
	});

	test('creates the log directory for a repo that has never logged friction', async () => {
		const { cwd, runId, logPath } = setupFrictionLog();

		await appendFriction({ cwd, runId, step: 'implement', friction: [{ area: 'plan', detail: 'a detail' }] });

		assert.ok(existsSync(logPath), `the log lands repo-wide at .lightsout/friction.jsonl, not under a run directory: ${logPath}`);
	});

	test('writes one line per reported entry, all stamped with the one moment the report landed', async () => {
		const { cwd, runId, readLines, readLog } = setupFrictionLog();

		await appendFriction({
			cwd,
			runId,
			step: 'refactor',
			friction: [
				{ kind: 'friction', area: 'standards', detail: 'the two rules disagreed' },
				{ kind: 'decision', area: 'plan', detail: 'chose the narrower reading' },
			],
		});

		const log = readLog();

		assert.equal(readLines().length, 2, `every entry leaves its own line: ${JSON.stringify(log)}`);
		assert.deepEqual(
			log.map((record) => [record.kind, record.area, record.detail]),
			[
				['friction', 'standards', 'the two rules disagreed'],
				['decision', 'plan', 'chose the narrower reading'],
			],
		);
		assert.equal(log[0]?.at, log[1]?.at, 'one report is one moment — its entries share a stamp');
	});

	test('leaves no log at all when the agent reported no friction', async () => {
		const { cwd, runId, logPath } = setupFrictionLog();

		await appendFriction({ cwd, runId, step: 'implement', friction: [] });

		assert.equal(existsSync(logPath), false, 'a clean run writes no line');
		assert.equal(existsSync(join(cwd, '.lightsout')), false, 'a clean run does not even create the directory');
	});

	test('appends beside the records earlier runs left instead of rewriting the log', async () => {
		const { cwd, runId, readLog } = setupFrictionLog({
			priorLine: { kind: 'friction', area: 'plan', detail: 'from an earlier run', at: '2026-07-03T00:00:00.000Z', runId: 'run-before', step: 'implement' },
		});

		await appendFriction({ cwd, runId, step: 'write-tests', friction: [{ kind: 'friction', area: 'prompt', detail: 'from this run' }] });

		const log = readLog();

		assert.equal(log.length, 2, `friction accumulates across runs so the improvement loop sees patterns: ${JSON.stringify(log)}`);
		assert.deepEqual(
			log.map((record) => record.runId),
			['run-before', 'run-friction'],
		);
	});

	test('writes a line with no kind key when the agent reported none', async () => {
		const { cwd, runId, readLog } = setupFrictionLog();

		await appendFriction({ cwd, runId, step: 'implement', friction: [{ area: 'plan', detail: 'the plan was silent on the boundary' }] });

		const [record] = readLog();

		assert.equal(Object.hasOwn(record, 'kind'), false, 'an unset kind leaves no key to misread as a reported one');
		assert.equal(record.detail, 'the plan was silent on the boundary');
	});

	test('coerces an area the taxonomy does not recognise to other rather than losing the entry', async () => {
		const { cwd, runId, readLog } = setupFrictionLog();

		await appendFriction({
			cwd,
			runId,
			step: 'implement',
			friction: [{ area: 'scope', detail: 'an area the agent invented' } as unknown as FrictionEntry],
		});

		const [record] = readLog();

		assert.equal(record?.area, 'other', 'the label is never load-bearing — the detail is');
		assert.equal(record?.detail, 'an area the agent invented');
	});

	test('strips a field the agent invented instead of carrying it into the ledger', async () => {
		const { cwd, runId, readLog } = setupFrictionLog();

		await appendFriction({
			cwd,
			runId,
			step: 'implement',
			friction: [{ kind: 'friction', area: 'plan', detail: 'a detail', severity: 'high' } as unknown as FrictionEntry],
		});

		const [record] = readLog();

		assert.deepEqual(Object.keys(record).sort(), ['area', 'at', 'detail', 'kind', 'runId', 'step'], 'the persisted shape is fixed');
	});

	test('keeps an entry whose detail spans several lines on one JSONL line', async () => {
		const { cwd, runId, readLines, readLog } = setupFrictionLog();

		await appendFriction({
			cwd,
			runId,
			step: 'implement',
			friction: [{ area: 'environment', detail: 'first line\nsecond line' }],
		});

		assert.equal(readLines().length, 1, 'a multi-line detail must not split the record across JSONL lines');
		assert.equal(readLog()[0]?.detail, 'first line\nsecond line');
	});

	test('rejects the report and writes nothing when an entry fails the record contract', async () => {
		const { cwd, runId, logPath } = setupFrictionLog();

		await assert.rejects(
			appendFriction({ cwd, runId, step: 'implement', friction: [{ area: 'plan', detail: 42 } as unknown as FrictionEntry] }),
		);

		assert.equal(existsSync(logPath), false, 'a malformed entry never leaves a half-written line behind');
	});
});
