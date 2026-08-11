import { BatchOutcome, BatchReport, type RefactorBatch, type RunManifest, RunStatus, type StepRecord } from '@/contracts';

interface Params {
	manifest: RunManifest;
	/** The frozen worklist's batches, in run order. */
	batches: RefactorBatch[];
}

interface ResumeState {
	declined: Array<{ batchId: string; remainingSiteKeys: string[]; rationale: string[] }>;
	declineStreak: number;
}

/**
 * Rebuild the run's decline state from persisted step records on resume — a
 * parked run's earlier declines are part of its final report (the human must
 * still review them), and the systemic-decline streak must survive the park
 * boundary or three consecutive declines split across a rate limit would
 * never trip it.
 */
export const seedResumeState = ({ manifest, batches }: Params): ResumeState => {
	const stepById = new Map<string, StepRecord>(manifest.steps.map((step) => [step.id, step]));
	const declined: ResumeState['declined'] = [];
	let declineStreak = 0;

	for (const batch of batches) {
		const step = stepById.get(batch.id);

		if (step?.status !== RunStatus.Passed) {
			// The resume loop picks up here — nothing beyond it has state.
			break;
		}

		const parsed = BatchReport.safeParse(step.report);

		if (parsed.success && parsed.data.outcome === BatchOutcome.Declined) {
			declined.push({ batchId: batch.id, remainingSiteKeys: parsed.data.remainingSiteKeys, rationale: parsed.data.rationale });
			declineStreak += 1;
		} else {
			declineStreak = 0;
		}
	}

	return { declined, declineStreak };
};
