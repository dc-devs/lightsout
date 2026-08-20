import { type RefactorBatch, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	batch: RefactorBatch;
	/** The run's standards packages — the judgment rules the agent review reads. */
	packages: LoadedStandardsPackage[];
	/** Active framework channels; a document out of play is not reviewed. */
	channels: string[];
	/** A live check's findings, which the machine advisories are filtered out of. */
	findings: StandardsFinding[];
	/** false skips the agent's read entirely — code-checks-only mode. */
	agentReview: boolean;
	timeoutMs: number;
	onProgress: (message: string) => void;
}

/**
 * Everything the batch's agent should weigh but nothing it can be held to: the
 * machine advisories standing on the batch's files, plus an agent's read of the
 * rules no check can cover.
 *
 * Both halves land in one list because the executor treats them the same way —
 * judge each against its own guidance, fix it unless an exemption applies, never
 * block on it. Every advisory touching the batch's files is included, not just
 * the size ones: each carries its own guidance, and one the agent never sees is
 * one it can never judge.
 *
 * A review that could not run leaves a note on the progress stream and no
 * findings — the batch is still real work, and a missing harness must not stop it.
 *
 * Code-checks-only mode (`agentReview: false`) keeps the machine advisories and
 * skips the agent's read — the caller opted out of that spend for the run.
 */
export const collectBatchAdvisories = async ({
	cwd,
	driver,
	batch,
	packages,
	channels,
	findings,
	agentReview,
	timeoutMs,
	onProgress,
}: Params): Promise<StandardsFinding[]> => {
	const batchFiles = new Set(batch.blocking.flatMap((finding) => finding.files.map((file) => file.path)));
	const machine = findings.filter((finding) => finding.severity === StandardsSeverity.Advisory && finding.files.some((file) => batchFiles.has(file.path)));

	if (!agentReview) {
		return machine;
	}

	const review = await runStandardsReview({
		cwd,
		driver,
		packages,
		channels,
		files: [...batchFiles],
		timeoutMs,
		onProgress: (message) => onProgress(`${batch.id}: agent review: ${message}`),
	});

	for (const note of review.notes) {
		onProgress(`${batch.id}: ${note}`);
	}

	return [...machine, ...review.findings];
};
