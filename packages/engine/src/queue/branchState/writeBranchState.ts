import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import type { BranchState } from '#src/contracts/queue/BranchState.ts';
import { getBranchStatePath } from '#src/queue/branchState/internal/common/utils/getBranchStatePath.ts';

interface Params {
	/** Any checkout of the repository; the record lands in the primary one, so it outlives the worktree. */
	cwd: string;
	branch: string;
	phase: BranchPhase;
	onProgress?: (message: string) => void;
}

/**
 * Record a branch's phase atomically (tmp file + rename), from the step that
 * just made it true.
 *
 * A failed write is a progress line and nothing more, and so is a branch no
 * work order claims: the two read alike to the lane on purpose. The run holding
 * this outcome in memory is complete either way, and turning a shipped ticket
 * into a parked one because a JSON write was impossible would be the worse
 * outcome — the next run simply re-derives what this one could not record.
 */
export const writeBranchState = async ({ cwd, branch, phase, onProgress }: Params): Promise<void> => {
	const record: BranchState = { branch, phase, updatedAt: new Date().toISOString() };

	try {
		// Resolved inside the try, so a checkout that cannot be resolved is reported
		// as the same progress line a refused write is rather than thrown at the lane.
		const statePath = await getBranchStatePath({ cwd, branch });

		if (statePath === undefined) {
			onProgress?.(`the branch state for ${branch} was not recorded as '${phase}': no work order's record stores that branch, so it keeps no local record`);

			return;
		}

		await mkdir(dirname(statePath), { recursive: true });
		await writeJsonFile({ path: `${statePath}.tmp`, value: record });
		await rename(`${statePath}.tmp`, statePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		onProgress?.(`the branch state for ${branch} could not be recorded as '${phase}': ${message}`);
	}
};
