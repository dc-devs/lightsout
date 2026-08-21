import { collectBatchChanges } from '#src/common/utils/collectBatchChanges.ts';
import type { AdvisoryOutcome, BatchOutcome, LightsoutConfig } from '#src/contracts/index.ts';
import { buildBatchReport } from '#src/refactor/batch/buildBatchReport.ts';
import type { BatchRecorder } from '#src/refactor/batch/common/types/BatchRecorder.ts';
import { BatchStopKind } from '#src/refactor/common/constants/BatchStopKind.ts';
import type { BatchStop } from '#src/refactor/common/types/BatchStop.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Files earlier steps already attributed — excluded from the git-truth merge. */
	attributedFiles: string[];
}

/** Create the one store a batch keeps of its own work — see {@link BatchRecorder}. */
export const createBatchRecorder = ({ cwd, config, attributedFiles }: Params): BatchRecorder => {
	const rationale: string[] = [];
	const reportedFiles = new Set<string>();
	const advisoryOutcomes = new Map<string, AdvisoryOutcome>();

	const reportOf = ({ outcome, remainingSiteKeys }: { outcome: BatchOutcome; remainingSiteKeys: string[] }) =>
		buildBatchReport({ outcome, remainingSiteKeys, rationale, advisoryOutcomes: [...advisoryOutcomes.values()] });

	/** Agents' reports unioned with git truth — what the batch has actually written so far. */
	const changedFiles = () => collectBatchChanges({ cwd, config, reportedFiles, attributedFiles });

	/** Every classified end of the batch goes through here, so no branch can report an outcome without the files it changed. */
	const finish = async ({ outcome, remainingSiteKeys }: { outcome: BatchOutcome; remainingSiteKeys: string[] }): Promise<BatchStop> => ({
		kind: BatchStopKind.Done,
		report: reportOf({ outcome, remainingSiteKeys }),
		changedFiles: await changedFiles(),
	});

	return { rationale, reportedFiles, advisoryOutcomes, reportOf, changedFiles, finish };
};
