import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { isProcessGroupAlive } from '#src/common/processes/isProcessGroupAlive.ts';

/**
 * A detached `sleep`, so its pid is also its group id. No shell: a shell may fork
 * `sleep` as a second group member, left as a zombie after the kill until init
 * reaps it, which would make the group read alive after the leader is gone.
 */
const setupDetachedChild = async () => {
	const child = spawn('sleep', ['30'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });

	await new Promise((resolve) => setTimeout(resolve, 100));

	return { child, pgid: child.pid ?? 0 };
};

/** Kill the whole group and wait until the leader has been reaped, so the group is really gone rather than a zombie. */
const stopGroup = async ({ child, pgid }: { child: ChildProcess; pgid: number }) => {
	try {
		process.kill(-pgid, 'SIGKILL');
	} catch {
		// already gone
	}

	await new Promise((resolve) => child.once('close', resolve));
};

describe('isProcessGroupAlive', () => {
	test("reports a detached child's group alive while it runs and dead once it has exited", async () => {
		const { child, pgid } = await setupDetachedChild();

		const whileRunning = isProcessGroupAlive({ pgid });
		await stopGroup({ child, pgid });
		const afterExit = isProcessGroupAlive({ pgid });

		expect({ whileRunning, afterExit }).toStrictEqual({ whileRunning: true, afterExit: false });
	});
});
