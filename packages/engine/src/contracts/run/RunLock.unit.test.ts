import { describe, expect, test } from '@jest/globals';
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

		expect(parsed).toStrictEqual({
			pid: 4242,
			runId: 'run-1',
			startedAt: '2026-01-01T00:00:00.000Z',
		});
	});

	test('every field is required — a lock missing any one of the three fails', () => {
		for (const field of ['pid', 'runId', 'startedAt']) {
			const { lock } = setupLock({ omit: field });

			// a lock without ${field} is unreadable rather than a partial holder — the
			// acquirer treats what it cannot parse as a crash leftover and steals it
			expect(RunLock.safeParse(lock).success).toBe(false);
		}
	});

	test('a fractional pid is refused — a process id is a whole number or the liveness check is meaningless', () => {
		const { lock } = setupLock({ extra: { pid: 4242.5 } });

		// the pid is what makes a crash leftover detectable, so it is held to the
		// shape the OS actually issues
		expect(RunLock.safeParse(lock).success).toBe(false);
	});

	test('a numeric string pid is refused rather than coerced', () => {
		const { lock } = setupLock({ extra: { pid: '4242' } });

		// a stringified pid would never match a live process — refusing it makes the
		// lock stale instead of a phantom conflict
		expect(RunLock.safeParse(lock).success).toBe(false);
	});

	test('a non-string runId or startedAt is refused', () => {
		for (const extra of [{ runId: 1 }, { startedAt: 1767225600000 }]) {
			const { lock } = setupLock({ extra });

			// the run id is an identifier the conflict message quotes back, and the start
			// time is recorded as a string timestamp — a number in either is a different
			// shape, not a coercion
			expect(RunLock.safeParse(lock).success).toBe(false);
		}
	});

	test('a zero pid and an empty runId parse — the schema pins shape, not liveness', () => {
		const { lock } = setupLock({ extra: { pid: 0, runId: '' } });

		const parsed = RunLock.parse(lock);

		// whether a pid is alive is the acquirer's question, decided after the lock
		// reads back
		expect(parsed.pid).toBe(0);
		// an empty id is a well-formed lock the acquirer can still compare and steal
		expect(parsed.runId).toBe('');
	});

	test('extra keys a leftover lock carries are stripped from the parsed record', () => {
		const { lock } = setupLock({ extra: { hostname: 'laptop.local', cwd: '/repo' } });

		const parsed = RunLock.parse(lock);

		// the lock normalizes to the three fields the engine acts on — a field an
		// older writer added never reaches the holder record
		expect('hostname' in parsed).toBe(false);
		expect('cwd' in parsed).toBe(false);
	});
});
