import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
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

/** Two detached shells at once — the arrangement for the every-child case. */
const setupChildPair = async () => ({ first: await setupChild(), second: await setupChild() });

/** A child that installs a no-op SIGTERM handler, so only SIGKILL can end it. */
const setupStubbornChild = async () => {
	const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1_000);"], {
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
	});

	await new Promise((resolve) => child.stdout?.once('data', resolve));

	return child;
};

describe('terminateChildGroups', () => {
	test('stops a backgrounded job, which would ignore an interrupt of its own', async () => {
		const { child, grandchildPid } = await setupChild();

		await terminateChildGroups({ children: [child] });

		// a shell sets SIGINT to ignore on the jobs it backgrounds, so relaying
		// Ctrl-C verbatim would leave this running with nothing left to stop it
		expect(await waitForExit({ pid: grandchildPid })).toBe(true);
		cleanup({ child, grandchildPid });
	});

	test('stops every child it is given, not just the first', async () => {
		const { first, second } = await setupChildPair();

		await terminateChildGroups({ children: [first.child, second.child] });

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

		// listened for before the terminate, which now returns only once the child
		// is already gone — a close waited on afterwards would never arrive
		const closed = new Promise((resolve) => child.once('close', resolve));

		await terminateChildGroups({ children: [child] });
		await closed;

		expect(output).toContain('cleaned');
	});

	test('kills a child that ignores the polite signal, once its grace period is up', async () => {
		const child = await setupStubbornChild();

		await terminateChildGroups({ children: [child], graceMs: 200 });
		await new Promise((resolve) => child.once('exit', resolve));

		// SIGTERM is catchable, so a harness that traps it and never exits would
		// otherwise outlive the engine that spawned it — still running, still
		// billing, with nothing left to stop it.
		expect(child.signalCode).toBe('SIGKILL');
	});

	test('returns as soon as the children are gone rather than waiting out the grace', async () => {
		const { child, grandchildPid } = await setupChild();
		const started = Date.now();

		await terminateChildGroups({ children: [child], graceMs: 10_000 });

		// a child that honours SIGTERM must not make Ctrl-C feel broken
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(await waitForExit({ pid: grandchildPid })).toBe(true);
		cleanup({ child, grandchildPid });
	});

	test('given nothing to stop, it does nothing', async () => {
		await expect(terminateChildGroups({ children: [] })).resolves.toBeUndefined();
	});
});
