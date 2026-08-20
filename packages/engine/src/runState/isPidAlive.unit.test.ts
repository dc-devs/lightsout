import { describe, expect, jest, test } from '@jest/globals';
import { isPidAlive } from '#src/runState/index.ts';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

/**
 * Swap the probe for one that raises a chosen failure. The two errnos the OS
 * can report mean opposite things — ESRCH is "no such process", EPERM is "it
 * exists, you just do not own it" — and only ESRCH happens on demand.
 */
const setupFailingProbe = ({ error }: { error: Error }) => {
	jest.spyOn(process, 'kill').mockImplementation((_pid: number, _signal?: string | number): true => {
		throw error;
	});
};

/** A probe that answers without failing, so what was asked of the OS is observable. */
const setupLiveProbe = () => {
	const kill = jest.spyOn(process, 'kill').mockImplementation((_pid: number, _signal?: string | number): true => true);

	return { kill };
};

describe('isPidAlive', () => {
	test('reports a running process as alive', () => {
		const alive = isPidAlive({ pid: process.pid });

		expect(alive).toBe(true);
	});

	test('reports a pid no process holds as dead, which is what makes a crash leftover stealable', () => {
		const alive = isPidAlive({ pid: deadPid });

		expect(alive).toBe(false);
	});

	test('reports a pid owned by another user as alive — EPERM means the process is there', () => {
		setupFailingProbe({ error: Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) });

		const alive = isPidAlive({ pid: 1 });

		// a lock held by another user is a live conflict, not a leftover to steal
		expect(alive).toBe(true);
	});

	test('reports a vanished pid as dead — ESRCH means nothing answers to it', () => {
		setupFailingProbe({ error: Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }) });

		const alive = isPidAlive({ pid: deadPid });

		expect(alive).toBe(false);
	});

	test('reports dead rather than propagating a failure that carries no errno', () => {
		setupFailingProbe({ error: new Error('probe exploded') });

		const alive = isPidAlive({ pid: deadPid });

		// the probe answers a question; it never becomes the failure itself
		expect(alive).toBe(false);
	});

	test('probes with signal 0 so a live holder is never actually signalled', () => {
		const { kill } = setupLiveProbe();

		isPidAlive({ pid: 4242 });

		expect(kill.mock.calls[0]).toStrictEqual([4242, 0]);
	});
});
