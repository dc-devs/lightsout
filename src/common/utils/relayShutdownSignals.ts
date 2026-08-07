import type { ChildProcess } from 'node:child_process';
import { terminateChildGroups } from '@/common/utils/terminateChildGroups';

const relayed: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
const live = new Set<ChildProcess>();

let installed = false;

const onSignal = (signal: NodeJS.Signals) => {
	terminateChildGroups({ children: live });

	// Re-raising restores the disposition the engine had before it listened: it
	// dies on Ctrl-C, with the exit status a caller expects. Merely listening
	// would swallow the interrupt and leave the engine running with no way to
	// stop it.
	uninstall();
	process.kill(process.pid, signal);
};

const handlers = new Map<NodeJS.Signals, () => void>(relayed.map((signal) => [signal, () => onSignal(signal)]));

const install = () => {
	if (installed) {
		return;
	}

	installed = true;

	for (const signal of relayed) {
		process.on(signal, handlers.get(signal) as () => void);
	}
};

function uninstall(): void {
	if (!installed) {
		return;
	}

	installed = false;

	for (const signal of relayed) {
		process.removeListener(signal, handlers.get(signal) as () => void);
	}
}

interface Params {
	/** A child spawned with `detached: true`, for as long as it is running. */
	child: ChildProcess;
}

/**
 * Pass Ctrl-C on to a running child, and stop when it exits.
 *
 * Putting a child in its own process group is what lets the engine kill it
 * wholesale, but it also takes the child out of the terminal's foreground
 * group — so Ctrl-C would no longer reach it, and interrupting the engine would
 * leave a harness running and billing. Relaying the signal restores what a user
 * expects while keeping the group.
 *
 * One pair of process listeners is shared by every live child rather than one
 * pair each, because several harnesses run at once (the test writers go up to
 * five in parallel) and per-child listeners would trip Node's max-listener
 * warning under load.
 *
 * @returns a function that stops relaying to this child — call it once the
 * child has settled, or its group id will be reused by an unrelated process.
 */
export const relayShutdownSignals = ({ child }: Params): (() => void) => {
	live.add(child);
	install();

	return () => {
		live.delete(child);

		if (live.size === 0) {
			uninstall();
		}
	};
};
