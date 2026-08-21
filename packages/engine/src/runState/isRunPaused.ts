import { RunStatus } from '#src/contracts/index.ts';

interface Params {
	status: RunStatus;
}

/**
 * Whether the run stopped because it was told to, rather than because
 * something went wrong.
 *
 * A `--max-batches` ceiling and a harness rate-limit wall both end a run with
 * work still to do, and neither is a fault: the first did exactly what the
 * caller asked, and the second is a wait. `failed` and `escalated` are not
 * paused — one broke and the other needs a person.
 *
 * The single definition, because a paused run is reported differently
 * everywhere it surfaces: its closing line is guidance on stdout rather than a
 * failure on stderr, and the CLI exits with its own code so a script can tell
 * "stopped where you asked" from "broke" without reading the text.
 */
export const isRunPaused = ({ status }: Params): boolean => status === RunStatus.PausedRateLimit || status === RunStatus.PausedBudget;
