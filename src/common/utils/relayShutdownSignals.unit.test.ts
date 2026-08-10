import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, jest, test } from '@jest/globals';
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

const alive = ({ pid }: { pid: number }) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

/** Listener counts for the signals the relay owns. */
const listeners = () => ({ interrupt: process.listenerCount('SIGINT'), terminate: process.listenerCount('SIGTERM') });

/**
 * A fresh copy of the module, so one test's shutdown does not latch the flag
 * the next test needs unset, plus the interrupt handler it installed and a
 * record of what it re-raises at the engine itself.
 *
 * `process.kill` is stubbed for the engine's own pid only — a real one would
 * end the test run, which is the very thing the code under test is for. Signals
 * aimed at the children still go through, so what reaches them is real.
 */
const setupRelay = async ({ child }: { child: ChildProcess }) => {
	jest.resetModules();

	const { relayShutdownSignals: fresh } = await import('@/common/utils/relayShutdownSignals');
	const raised: NodeJS.Signals[] = [];
	const realKill = process.kill.bind(process);

	jest.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
		if (pid === process.pid) {
			raised.push(signal as NodeJS.Signals);

			return true;
		}

		return realKill(pid, signal as NodeJS.Signals);
	});

	const before = process.listeners('SIGINT');

	fresh({ child });

	const handler = process.listeners('SIGINT').find((listener) => !before.includes(listener)) as () => void;

	return { handler, raised };
};

/** The handler cannot be awaited — Node calls it for its side effects — so settle on what it records. */
const waitForRaise = async ({ raised }: { raised: NodeJS.Signals[] }) => {
	for (let attempt = 1; attempt <= 200 && raised.length === 0; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	return raised;
};

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

	test('stops the children before re-raising, so nothing outlives the engine', async () => {
		const { child, grandchildPid } = await setupChild();
		const { handler, raised } = await setupRelay({ child });

		handler();

		expect(await waitForRaise({ raised })).toStrictEqual(['SIGINT']);

		// the re-raise is what ends the engine, so anything still running when it
		// happens is orphaned — the children must already be gone by then
		expect(alive({ pid: grandchildPid })).toBe(false);
		cleanup({ child, grandchildPid });
	});

	test('ignores a repeat interrupt instead of restarting the grace period', async () => {
		const { child, grandchildPid } = await setupChild();
		const { handler, raised } = await setupRelay({ child });

		handler();
		handler();

		await waitForRaise({ raised });
		await new Promise((resolve) => setTimeout(resolve, 100));

		// a second Ctrl-C arriving mid-shutdown would otherwise start the wait
		// over, making an impatient press the slowest way out
		expect(raised).toStrictEqual(['SIGINT']);
		cleanup({ child, grandchildPid });
	});
});
