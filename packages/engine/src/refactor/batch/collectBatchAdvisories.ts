import { type RefactorBatch, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatchReview } from '#src/refactor/batch/runBatchReview.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	/** Provenance for the judgment ledger — which run's review this was. */
	runId: string;
	driver: Driver;
	batch: RefactorBatch;
	/** The run's standards packs — the judgment rules the agent review reads. */
	packs: LoadedStandardsPack[];
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
 * skips the agent's read — the caller opted out of that spend for the run. The
 * skip lives in the review itself, so both of a batch's reads honour it.
 */
export const collectBatchAdvisories = async ({
	cwd,
	runId,
	driver,
	batch,
	packs,
	channels,
	findings,
	agentReview,
	timeoutMs,
	onProgress,
}: Params): Promise<StandardsFinding[]> => {
	const batchFiles = new Set(batch.blocking.flatMap((finding) => finding.files.map((file) => file.path)));
	const machine = findings.filter((finding) => finding.severity === StandardsSeverity.Advisory && finding.files.some((file) => batchFiles.has(file.path)));

	const reviewed = await runBatchReview({ cwd, runId, driver, batch, packs, channels, files: [...batchFiles], agentReview, timeoutMs, onProgress });

	return [...machine, ...reviewed];
};
