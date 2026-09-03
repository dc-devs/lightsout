import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { BranchPhase, BranchState } from '#src/contracts/index.ts';
import { getBranchStatePath } from '#src/queue/branchState/common/utils/getBranchStatePath.ts';

interface Params {
	/** The MAIN repository checkout, so the record outlives the worktree. */
	cwd: string;
	branch: string;
	phase: BranchPhase;
	onProgress?: (message: string) => void;
}

/**
 * Record a branch's phase atomically (tmp file + rename), from the step that
 * just made it true.
 *
 * A failed write is a progress line and nothing more. The run holding this
 * outcome in memory is complete either way, and turning a shipped ticket into a
 * parked one because a JSON write failed would be the worse outcome — the next
 * run simply re-derives what this one could not record.
 */
export const writeBranchState = async ({ cwd, branch, phase, onProgress }: Params): Promise<void> => {
	const record: BranchState = { branch, phase, updatedAt: new Date().toISOString() };
	const statePath = getBranchStatePath({ cwd, branch });

	try {
		await mkdir(dirname(statePath), { recursive: true });
		await writeJsonFile({ path: `${statePath}.tmp`, value: record });
		await rename(`${statePath}.tmp`, statePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		onProgress?.(`the branch state for ${branch} could not be recorded as '${phase}': ${message}`);
	}
};
