import { BatchOutcome, CoverageBatchReport, RunStatus, type RunManifest } from '@/contracts';
import type { CoverageSetAside } from '@/coverage/common/types/CoverageSetAside';
import { updateFileStrikes } from '@/coverage/common/utils/updateFileStrikes';

interface Params {
	manifest: RunManifest;
}

interface ResumeState {
	setAside: CoverageSetAside[];
	declineStreak: number;
	/** Per-file no-improvement strikes across resolved batches (path → count); files at maxFileStrikes are already folded into setAside. */
	fileStrikes: Map<string, number>;
	/** Count of persisted batch steps — the next batch number continues from here. */
	batchCount: number;
}

/**
 * Rebuild a coverage run's state from persisted step records on resume.
 *
 * A coverage run has no frozen batch list — every round re-measures — so the
 * batch reports themselves are the only durable record of what was set aside,
 * how long the decline streak is, how many batches have run, and which files
 * have been carried through improving batches without improving themselves.
 * Never process memory: three declines split across a rate limit must still
 * trip the systemic stop.
 */
export const seedCoverageResumeState = ({ manifest }: Params): ResumeState => {
	const setAside: ResumeState['setAside'] = [];
	const fileStrikes = new Map<string, number>();
	let declineStreak = 0;
	let batchCount = 0;

	for (const step of manifest.steps.filter((entry) => entry.id.startsWith('batch-'))) {
		batchCount += 1;

		const parsed = CoverageBatchReport.safeParse(step.report);

		// A batch that never passed will be re-run under a fresh number; a report
		// that does not parse is not evidence of anything.
		if (step.status !== RunStatus.Passed || !parsed.success) {
			continue;
		}

		if (parsed.data.outcome === BatchOutcome.Declined) {
			setAside.push({ batchId: step.id, files: parsed.data.files.map((file) => file.path), rationale: parsed.data.rationale });
			declineStreak += 1;
			continue;
		}

		declineStreak = 0;

		setAside.push(...updateFileStrikes({ batchId: step.id, files: parsed.data.files, fileStrikes }));
	}

	return { setAside, declineStreak, fileStrikes, batchCount };
};
