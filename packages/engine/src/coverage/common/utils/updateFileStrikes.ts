import type { CoverageBatchReport } from '#src/contracts/index.ts';
import { maxFileStrikes } from '#src/coverage/common/constants/maxFileStrikes.ts';
import type { CoverageSetAside } from '#src/coverage/common/types/CoverageSetAside.ts';

interface Params {
	/** The batch whose report is being folded in — the id a new set-aside entry cites. */
	batchId: string;
	files: CoverageBatchReport['files'];
	/** The run's per-file strike counts, updated in place. */
	fileStrikes: Map<string, number>;
}

/**
 * Fold one RESOLVED batch's report into the run's per-file strike counts and
 * return the files that just reached the limit.
 *
 * The free-rider guard: a hard file can ride along in improving batches forever
 * without ever tripping the batch-level decline rule, so it earns a set-aside
 * of its own. The live run applies this as each batch resolves and a resumed
 * run replays it from the same persisted reports — one function, so the two can
 * never disagree about which files a human already owns.
 */
export const updateFileStrikes = ({ batchId, files, fileStrikes }: Params): CoverageSetAside[] => {
	const setAside: CoverageSetAside[] = [];

	for (const file of files) {
		if (file.afterPct > file.beforePct) {
			fileStrikes.set(file.path, 0);
			continue;
		}

		const strikes = (fileStrikes.get(file.path) ?? 0) + 1;

		fileStrikes.set(file.path, strikes);

		if (strikes === maxFileStrikes) {
			setAside.push({ batchId, files: [file.path], rationale: [`no improvement across ${maxFileStrikes} batches — likely needs source changes`] });
		}
	}

	return setAside;
};
