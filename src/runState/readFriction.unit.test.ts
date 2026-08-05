import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { readFriction } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** A well-formed persisted record: the entry plus its provenance. */
const record = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		kind: 'friction',
		area: 'plan',
		detail: 'the plan was silent on the boundary',
		at: '2026-07-03T00:00:00.000Z',
		runId: 'run-a',
		step: 'implement',
		...overrides,
	});

interface SetupParams {
	/** Raw lines written to friction.jsonl verbatim — malformed ones included. */
	lines?: string[];
}

const setupFrictionLog = ({ lines }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const logPath = join(cwd, '.lightsout', 'friction.jsonl');

	if (lines) {
		mkdirSync(dirname(logPath), { recursive: true });
		writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
	}

	return { cwd, logPath };
};

describe('readFriction', () => {
	test('reads every accumulated record with its provenance, in the order logged', async () => {
		const { cwd } = setupFrictionLog({
			lines: [record(), record({ kind: 'decision', area: 'standards', detail: 'chose the newer rule', runId: 'run-b', step: 'refactor' })],
		});

		const friction = await readFriction({ cwd });

		assert.deepEqual(friction, [
			{ kind: 'friction', area: 'plan', detail: 'the plan was silent on the boundary', at: '2026-07-03T00:00:00.000Z', runId: 'run-a', step: 'implement' },
			{ kind: 'decision', area: 'standards', detail: 'chose the newer rule', at: '2026-07-03T00:00:00.000Z', runId: 'run-b', step: 'refactor' },
		]);
	});

	test('reads empty for a repo that has logged no friction at all', async () => {
		const { cwd } = setupFrictionLog();

		const friction = await readFriction({ cwd });

		assert.deepEqual(friction, [], 'a missing log is an empty history, not a failure');
	});

	test('skips a line that is not JSON and keeps the records around it', async () => {
		const { cwd } = setupFrictionLog({
			lines: [record({ detail: 'first' }), 'not json at all', record({ detail: 'third' })],
		});

		const friction = await readFriction({ cwd });

		assert.deepEqual(
			friction.map((entry) => entry.detail),
			['first', 'third'],
		);
	});

	test('skips a line that fails the record contract rather than guessing its provenance', async () => {
		const { cwd } = setupFrictionLog({
			lines: [
				JSON.stringify({ area: 'plan', detail: 'no provenance on this one' }),
				record({ detail: 'complete record' }),
				JSON.stringify({ area: 'plan', detail: 42, at: '2026-07-03T00:00:00.000Z', runId: 'run-a', step: 'implement' }),
			],
		});

		const friction = await readFriction({ cwd });

		assert.deepEqual(
			friction.map((entry) => entry.detail),
			['complete record'],
		);
	});

	test('ignores blank lines left by an interrupted append', async () => {
		const { cwd } = setupFrictionLog({ lines: [record({ detail: 'first' }), '', record({ detail: 'second' }), ''] });

		const friction = await readFriction({ cwd });

		assert.equal(friction.length, 2);
	});

	test('keeps a record whose area the taxonomy does not recognise, coercing it to other', async () => {
		const { cwd } = setupFrictionLog({ lines: [record({ area: 'scope', detail: 'invented an area' })] });

		const friction = await readFriction({ cwd });

		assert.deepEqual(friction, [
			{ kind: 'friction', area: 'other', detail: 'invented an area', at: '2026-07-03T00:00:00.000Z', runId: 'run-a', step: 'implement' },
		]);
	});

	test('reads the repo-wide log, not a single run directory', async () => {
		const { cwd } = setupFrictionLog({ lines: [record({ runId: 'run-a' }), record({ runId: 'run-b' })] });

		const friction = await readFriction({ cwd });

		assert.deepEqual(
			friction.map((entry) => entry.runId),
			['run-a', 'run-b'],
			'friction accumulates across runs so the improvement loop sees patterns',
		);
	});
});
