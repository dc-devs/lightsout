import type { ChildProcess } from 'node:child_process';
import { killGraceMs } from '#src/common/constants/killGraceMs.ts';
import { killProcessGroup } from '#src/common/utils/killProcessGroup.ts';

interface Params {
	children: Iterable<ChildProcess>;
	/** How long the children get to honour SIGTERM before they are killed outright. */
	graceMs?: number;
}

const settled = ({ child }: { child: ChildProcess }) => child.exitCode !== null || child.signalCode !== null;

const exited = ({ child }: { child: ChildProcess }): Promise<void> =>
	settled({ child }) ? Promise.resolve() : new Promise((resolve) => child.once('exit', () => resolve()));

/**
 * Stop every given child, and everything it started, before returning.
 *
 * SIGTERM first, regardless of what prompted the shutdown, because the contract
 * is that the run ends — not that a particular signal is passed along. A shell
 * sets SIGINT to ignore on the jobs it backgrounds, so relaying Ctrl-C verbatim
 * would leave a harness that backgrounded its work still running with nothing
 * left to stop it. SIGTERM can still be caught, so a child keeps its chance to
 * clean up on the way out.
 *
 * Whatever is still alive when the grace period expires is then killed
 * outright. Without that escalation a harness only has to trap SIGTERM and
 * decline to act on it to outlive the engine that spawned it — reparented to
 * init on a machine nobody is watching, which is the failure this product
 * cannot have. The grace timer is deliberately NOT unref'd: the caller's next
 * act is usually to end the engine, and a kill that the runtime is free to skip
 * is not a kill.
 *
 * Returning early once the children are gone is what keeps an honoured Ctrl-C
 * feeling immediate — the full grace is only ever paid by a child that earned
 * it.
 */
export const terminateChildGroups = async ({ children, graceMs = killGraceMs }: Params): Promise<void> => {
	const targets = [...children];

	for (const child of targets) {
		killProcessGroup({ child, signal: 'SIGTERM' });
	}

	if (targets.length === 0) {
		return;
	}

	let grace: NodeJS.Timeout | undefined;

	await Promise.race([
		Promise.all(targets.map((child) => exited({ child }))),
		new Promise((resolve) => {
			grace = setTimeout(resolve, graceMs);
		}),
	]);

	clearTimeout(grace);

	for (const child of targets) {
		if (!settled({ child })) {
			killProcessGroup({ child, signal: 'SIGKILL' });
		}
	}
};
