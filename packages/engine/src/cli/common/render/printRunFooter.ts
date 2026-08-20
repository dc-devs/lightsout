import type { RunManifest } from '#src/contracts/index.ts';

interface Params {
	manifest: RunManifest;
	/** The run's failure message, when it has one — printed to stderr, last. */
	error?: string;
}

/**
 * How every batched run's report ends: what it left in the working tree, where
 * the evidence landed, and the failure message when there is one. The
 * commit reminder is the important half — the engine writes code and never
 * commits it, so an unread tree is the one way a run's work goes missing.
 */
export const printRunFooter = ({ manifest, error }: Params): void => {
	if (manifest.changedFiles.length > 0) {
		console.log(`\n${manifest.changedFiles.length} file(s) changed in the working tree — review and commit; the engine never commits.`);
	}

	console.log(`evidence: .lightsout/runs/${manifest.runId}/`);

	if (error) {
		console.error(`\n${error}`);
	}
};
