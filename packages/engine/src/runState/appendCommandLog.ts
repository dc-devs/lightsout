import type { GateEvidence } from '#src/contracts/index.ts';
import { appendRunLog } from '#src/runState/common/utils/appendRunLog.ts';

interface Params {
	cwd: string;
	runId: string;
	/**
	 * The line to append, as the contract defines it. Taken from `GateEvidence`
	 * rather than restated here: it is `GateResult` plus the two fields only the
	 * log carries, and a second spelling of it drifts — this one had already lost
	 * `rerun`, which a flake re-run writes and the run summary counts.
	 */
	record: GateEvidence;
}
/**
 * Append one gate-command execution to the run's `commands.jsonl`. Every
 * command is recorded, passing, failing or skipped — a green gate that
 * leaves no evidence is indistinguishable from a gate that never ran.
 */
export const appendCommandLog = async ({ cwd, runId, record }: Params): Promise<void> => {
	await appendRunLog({ cwd, runId, fileName: 'commands.jsonl', record });
};
