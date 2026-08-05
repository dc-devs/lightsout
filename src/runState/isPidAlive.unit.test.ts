import assert from 'node:assert/strict';
import { describe, test, type TestContext } from 'node:test';
import { isPidAlive } from '@/runState';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

/**
 * Swap the probe for one that raises a chosen failure. The two errnos the OS
 * can report mean opposite things — ESRCH is "no such process", EPERM is "it
 * exists, you just do not own it" — and only ESRCH happens on demand.
 */
const setupFailingProbe = ({ t, error }: { t: TestContext; error: Error }) => {
	t.mock.method(process, 'kill', (_pid: number, _signal?: string | number): true => {
		throw error;
	});
};

/** A probe that answers without failing, so what was asked of the OS is observable. */
const setupLiveProbe = ({ t }: { t: TestContext }) => {
	const kill = t.mock.method(process, 'kill', (_pid: number, _signal?: string | number): true => true);

	return { kill };
};

describe('isPidAlive', () => {
	test('reports a running process as alive', () => {
		const alive = isPidAlive({ pid: process.pid });

		assert.equal(alive, true);
	});

	test('reports a pid no process holds as dead, which is what makes a crash leftover stealable', () => {
		const alive = isPidAlive({ pid: deadPid });

		assert.equal(alive, false);
	});

	test('reports a pid owned by another user as alive — EPERM means the process is there', (t) => {
		setupFailingProbe({ t, error: Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) });

		const alive = isPidAlive({ pid: 1 });

		assert.equal(alive, true, 'a lock held by another user is a live conflict, not a leftover to steal');
	});

	test('reports a vanished pid as dead — ESRCH means nothing answers to it', (t) => {
		setupFailingProbe({ t, error: Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }) });

		const alive = isPidAlive({ pid: deadPid });

		assert.equal(alive, false);
	});

	test('reports dead rather than propagating a failure that carries no errno', (t) => {
		setupFailingProbe({ t, error: new Error('probe exploded') });

		const alive = isPidAlive({ pid: deadPid });

		assert.equal(alive, false, 'the probe answers a question; it never becomes the failure itself');
	});

	test('probes with signal 0 so a live holder is never actually signalled', (t) => {
		const { kill } = setupLiveProbe({ t });

		isPidAlive({ pid: 4242 });

		assert.deepEqual(kill.mock.calls[0]?.arguments, [4242, 0]);
	});
});
