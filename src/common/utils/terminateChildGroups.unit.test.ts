import { spawn, type ChildProcess } from 'node:child_process';
import { expect, describe, test } from '@jest/globals';
import { terminateChildGroups } from '@/common/utils/terminateChildGroups';

/** A detached shell that backgrounds a long sleep and reports its pid. */
const setupChild = async () => {
	const child = spawn('sleep 30 & echo $!; wait', { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
	const grandchildPid = await new Promise<number>((resolve) => {
		child.stdout?.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())));
	});

	return { child, grandchildPid };
};

const alive = ({ pid }: { pid: number }) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

const waitForExit = async ({ pid }: { pid: number }) => {
	for (let attempt = 1; attempt <= 100 && alive({ pid }); attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	return !alive({ pid });
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

describe('terminateChildGroups', () => {
	test('stops a backgrounded job, which would ignore an interrupt of its own', async () => {
		const { child, grandchildPid } = await setupChild();

		terminateChildGroups({ children: [child] });

		// a shell sets SIGINT to ignore on the jobs it backgrounds, so relaying
		// Ctrl-C verbatim would leave this running with nothing left to stop it
		expect(await waitForExit({ pid: grandchildPid })).toBe(true);
		cleanup({ child, grandchildPid });
	});

	test('stops every child it is given, not just the first', async () => {
		const first = await setupChild();
		const second = await setupChild();

		terminateChildGroups({ children: [first.child, second.child] });

		expect(await waitForExit({ pid: first.grandchildPid })).toBe(true);
		expect(await waitForExit({ pid: second.grandchildPid })).toBe(true);
		cleanup(first);
		cleanup(second);
	});

	test('sends a signal a child can catch, so its own cleanup still runs', async () => {
		const child = spawn("trap 'echo cleaned; exit 0' TERM; sleep 30 & wait", { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
		let output = '';

		child.stdout?.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});

		await new Promise((resolve) => setTimeout(resolve, 100));
		terminateChildGroups({ children: [child] });
		await new Promise((resolve) => child.once('close', resolve));

		expect(output).toContain('cleaned');
	});

	test('given nothing to stop, it does nothing', () => {
		expect(() => terminateChildGroups({ children: [] })).not.toThrow();
	});
});
