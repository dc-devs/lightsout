import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RunLock } from '@/contracts';

/** The three fields a live holder writes to `.lightsout/lock.json`. */
const setupLock = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const lock: Record<string, unknown> = {
		pid: 4242,
		runId: 'run-1',
		startedAt: '2026-01-01T00:00:00.000Z',
		...extra,
	};

	if (omit) {
		delete lock[omit];
	}

	return { lock };
};

describe('RunLock', () => {
	test('parses a complete lock, keeping the pid, the run it belongs to, and when it was taken', () => {
		const { lock } = setupLock();

		const parsed = RunLock.parse(lock);

		assert.deepEqual(parsed, {
			pid: 4242,
			runId: 'run-1',
			startedAt: '2026-01-01T00:00:00.000Z',
		});
	});

	test('every field is required — a lock missing any one of the three fails', () => {
		for (const field of ['pid', 'runId', 'startedAt']) {
			const { lock } = setupLock({ omit: field });

			assert.equal(RunLock.safeParse(lock).success, false, `a lock without ${field} is unreadable rather than a partial holder — the acquirer treats what it cannot parse as a crash leftover and steals it`);
		}
	});

	test('a fractional pid is refused — a process id is a whole number or the liveness check is meaningless', () => {
		const { lock } = setupLock({ extra: { pid: 4242.5 } });

		assert.equal(RunLock.safeParse(lock).success, false, 'the pid is what makes a crash leftover detectable, so it is held to the shape the OS actually issues');
	});

	test('a numeric string pid is refused rather than coerced', () => {
		const { lock } = setupLock({ extra: { pid: '4242' } });

		assert.equal(RunLock.safeParse(lock).success, false, 'a stringified pid would never match a live process — refusing it makes the lock stale instead of a phantom conflict');
	});

	test('a non-string runId or startedAt is refused', () => {
		const { lock: numericRunId } = setupLock({ extra: { runId: 1 } });
		const { lock: numericStartedAt } = setupLock({ extra: { startedAt: 1767225600000 } });

		assert.equal(RunLock.safeParse(numericRunId).success, false, 'the run id is an identifier the conflict message quotes back, not a number');
		assert.equal(RunLock.safeParse(numericStartedAt).success, false, 'the start time is recorded as a string timestamp — an epoch number is a different shape, not a coercion');
	});

	test('a zero pid and an empty runId parse — the schema pins shape, not liveness', () => {
		const { lock } = setupLock({ extra: { pid: 0, runId: '' } });

		const parsed = RunLock.parse(lock);

		assert.equal(parsed.pid, 0, 'whether a pid is alive is the acquirer\'s question, decided after the lock reads back');
		assert.equal(parsed.runId, '', 'an empty id is a well-formed lock the acquirer can still compare and steal');
	});

	test('extra keys a leftover lock carries are stripped from the parsed record', () => {
		const { lock } = setupLock({ extra: { hostname: 'laptop.local', cwd: '/repo' } });

		const parsed = RunLock.parse(lock);

		assert.equal('hostname' in parsed, false, 'the lock normalizes to the three fields the engine acts on — a field an older writer added never reaches the holder record');
		assert.equal('cwd' in parsed, false);
	});
});
