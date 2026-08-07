import { spawn, type ChildProcess } from 'node:child_process';
import { expect, describe, test } from '@jest/globals';
import { relayShutdownSignals } from '@/common/utils/relayShutdownSignals';

/** A detached shell that reports its grandchild's pid, then waits. */
const setupChild = async () => {
	const child = spawn('sleep 30 & echo $!; wait', { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
	const grandchildPid = await new Promise<number>((resolve) => {
		child.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
	});

	return { child, grandchildPid };
};

const cleanup = ({ child, grandchildPid }: { child: ChildProcess; grandchildPid: number }) => {
	for (const pid of [child.pid, grandchildPid]) {
		try {
			if (pid !== undefined) {
				process.kill(pid, 'SIGKILL');
			}
		} catch {
			// already gone
		}
	}
};

/** Listener counts for the signals the relay owns. */
const listeners = () => ({ interrupt: process.listenerCount('SIGINT'), terminate: process.listenerCount('SIGTERM') });

describe('relayShutdownSignals', () => {
	test('listens while a child is running and stops once it is released', async () => {
		const { child, grandchildPid } = await setupChild();
		const before = listeners();

		const stop = relayShutdownSignals({ child });

		expect(listeners()).toStrictEqual({ interrupt: before.interrupt + 1, terminate: before.terminate + 1 });

		stop();

		// a stale listener would go on signalling a pid the OS has since reused
		expect(listeners()).toStrictEqual(before);
		cleanup({ child, grandchildPid });
	});

	test('shares one pair of listeners across every live child', async () => {
		const first = await setupChild();
		const second = await setupChild();
		const before = listeners();

		const stopFirst = relayShutdownSignals({ child: first.child });
		const stopSecond = relayShutdownSignals({ child: second.child });

		// five test writers run at once; a pair each would trip Node's
		// max-listener warning
		expect(listeners()).toStrictEqual({ interrupt: before.interrupt + 1, terminate: before.terminate + 1 });

		stopFirst();

		// still one child left, so the listeners stay
		expect(listeners()).toStrictEqual({ interrupt: before.interrupt + 1, terminate: before.terminate + 1 });

		stopSecond();

		expect(listeners()).toStrictEqual(before);
		cleanup(first);
		cleanup(second);
	});

	test('releasing the same child twice leaves the listener count alone', async () => {
		const { child, grandchildPid } = await setupChild();
		const before = listeners();
		const stop = relayShutdownSignals({ child });

		stop();
		stop();

		expect(listeners()).toStrictEqual(before);
		cleanup({ child, grandchildPid });
	});
});
