import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { killProcessGroup } from '#src/common/processes/killProcessGroup.ts';

/** True while a pid is still a live process. */
const alive = ({ pid }: { pid: number }) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

const settle = async ({ until, tries = 100 }: { until: () => boolean; tries?: number }) => {
	for (let attempt = 1; attempt <= tries; attempt += 1) {
		if (until()) {
			return true;
		}

		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	return false;
};

/**
 * A detached shell that starts a long-lived grandchild and reports its pid —
 * the shape that used to survive a kill.
 */
const setupTree = async () => {
	const child = spawn('sleep 30 & echo $!; wait', { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

	const grandchildPid = await new Promise<number>((resolve) => {
		child.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
	});

	return { child, grandchildPid };
};

const stop = ({ child, grandchildPid }: { child: ChildProcess; grandchildPid: number }) => {
	killProcessGroup({ child, signal: 'SIGKILL' });

	try {
		process.kill(grandchildPid, 'SIGKILL');
	} catch {
		// already gone, which is what the test wanted
	}
};

describe('killProcessGroup', () => {
	test('kills the descendants a plain child.kill would leave running', async () => {
		const { child, grandchildPid } = await setupTree();

		expect(alive({ pid: grandchildPid })).toBe(true);

		killProcessGroup({ child, signal: 'SIGKILL' });

		// the grandchild would otherwise reparent to init and keep the inherited
		// stdout pipe open for the rest of its 30 seconds
		expect(await settle({ until: () => !alive({ pid: grandchildPid }) })).toBe(true);
	});

	test('delivers a catchable signal, so a child can still clean up after itself', async () => {
		const child = spawn("trap 'echo caught; exit 0' TERM; sleep 30 & wait", { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
		let output = '';

		child.stdout?.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});

		await new Promise((resolve) => setTimeout(resolve, 100));
		killProcessGroup({ child, signal: 'SIGTERM' });
		await new Promise((resolve) => child.once('close', resolve));

		expect(output).toContain('caught');
	});

	test('still kills a child that leads no group, rather than silently doing nothing', async () => {
		// not detached: there is no group at -pid, and a swallowed failure here
		// would leave the child running with the caller believing it was killed
		const child = spawn('sleep 30', { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

		await new Promise((resolve) => setTimeout(resolve, 50));
		killProcessGroup({ child, signal: 'SIGKILL' });

		expect(await settle({ until: () => child.killed || child.exitCode !== null || child.signalCode !== null })).toBe(true);
	});

	test('a group that has already exited is not an error', async () => {
		const { child, grandchildPid } = await setupTree();

		stop({ child, grandchildPid });
		await new Promise((resolve) => child.once('close', resolve));

		// reaping something already reaped is the ordinary case, not a failure
		expect(() => killProcessGroup({ child, signal: 'SIGKILL' })).not.toThrow();
	});
});
