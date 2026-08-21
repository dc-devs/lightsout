import type { RunManifest } from '#src/contracts/index.ts';
import { isRunPaused } from '#src/runState/index.ts';

interface Params {
	manifest: RunManifest;
	/** Why the run ended, when it did not simply finish. */
	ending?: string;
}

/**
 * How every batched run's report ends: what it left in the working tree, where
 * the evidence landed, and why it stopped when it did.
 *
 * The commit reminder is the important half — the engine writes code and never
 * commits it, so an unread tree is the one way a run's work goes missing.
 *
 * A paused run's closing line goes to stdout. `refactor --max-batches 3` that
 * finishes three batches did exactly what it was asked, and printing "resume
 * with …" on stderr under a status of PAUSED-BUDGET read as a run that broke.
 * A run that actually broke still writes to stderr.
 */
export const printRunFooter = ({ manifest, ending }: Params): void => {
	if (manifest.changedFiles.length > 0) {
		console.log(`\n${manifest.changedFiles.length} file(s) changed in the working tree — review and commit; the engine never commits.`);
	}

	console.log(`evidence: .lightsout/runs/${manifest.runId}/`);

	if (ending === undefined) {
		return;
	}

	if (isRunPaused({ status: manifest.status })) {
		console.log(`\n${ending}`);
	} else {
		console.error(`\n${ending}`);
	}
};
