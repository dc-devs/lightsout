import type { ChildProcess } from 'node:child_process';
import { killProcessGroup } from '@/common/utils/killProcessGroup';

interface Params {
	children: Iterable<ChildProcess>;
}

/**
 * Ask every given child, and everything it started, to stop.
 *
 * SIGTERM regardless of what prompted the shutdown, because the contract is
 * that the run ends — not that a particular signal is passed along. A shell
 * sets SIGINT to ignore on the jobs it backgrounds, so relaying Ctrl-C verbatim
 * would leave a harness that backgrounded its work still running with nothing
 * left to stop it. SIGTERM can still be caught, so a child keeps its chance to
 * clean up on the way out.
 */
export const terminateChildGroups = ({ children }: Params): void => {
	for (const child of children) {
		killProcessGroup({ child, signal: 'SIGTERM' });
	}
};
