import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import { ShipBlockReason } from '#src/contracts/index.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import type { IntegrationFailure } from '#src/ship/integration/common/types/IntegrationFailure.ts';
import { invokeShipIntegrator } from '#src/ship/integration/invokeShipIntegrator.ts';
import { readConflictMarkerPaths } from '#src/ship/integration/readConflictMarkerPaths.ts';
import { readUnmergedPaths } from '#src/ship/integration/readUnmergedPaths.ts';

interface Params {
	cwd: string;
	integration: ShipIntegration;
	branch: string;
	defaultBranch: string;
	standards?: string;
	conflictPaths: string[];
	onProgress?: (message: string) => void;
}

/** Git could not answer, so there is no evidence either way — never the same thing as "nothing is left unresolved". */
const unreadable = ({ detail }: { detail: string }): IntegrationFailure => ({ reason: ShipBlockReason.IntegrationUnavailable, detail, paths: [] });

/**
 * What git says is still unsettled after an attempt: the paths it lists as
 * unmerged, and — when it lists none — the paths the attempt staged or left on
 * disk still carrying conflict markers.
 *
 * Staging is what marks a path resolved, so an agent that stages a file it
 * never settled empties the unmerged list without settling anything. Both
 * readings are needed before an attempt counts.
 */
const readUnsettledPaths = async ({ cwd }: { cwd: string }): Promise<{ paths: string[]; reason: string } | { error: string }> => {
	const unmerged = await readUnmergedPaths({ cwd });

	if (unmerged === undefined) {
		return { error: 'git could not say what is still unmerged' };
	}

	if (unmerged.length > 0) {
		return { paths: unmerged, reason: 'git still lists them as unmerged' };
	}

	const marked = await readConflictMarkerPaths({ cwd });

	if (marked === undefined) {
		return { error: 'git could not be read for conflict markers left behind' };
	}

	return { paths: marked, reason: 'they still carry conflict markers this attempt introduced' };
};

/**
 * The bounded conflict recovery: hand the agent the conflicted paths, then ask
 * GIT whether anything is still unsettled.
 *
 * The order is the whole point. An agent that reports success while git still
 * lists a path unmerged — or while the file it staged still carries the
 * markers — has spent an attempt and nothing more; its own account is never
 * the evidence.
 *
 * The allowance is `maxCheapFixRetries`, the shared constant the direct
 * pipeline spends: one resolution attempt followed by one corrective attempt.
 * Nothing here aborts, commits or restores — the caller owns every git state
 * transition.
 *
 * @returns undefined once the tree is fully settled, else why the allowance ran out and on which paths
 */
export const resolveMergeConflicts = async ({
	cwd,
	integration,
	branch,
	defaultBranch,
	standards,
	conflictPaths,
	onProgress,
}: Params): Promise<IntegrationFailure | undefined> => {
	let paths = conflictPaths;
	let detail = `merging origin/${defaultBranch} left ${paths.length} path(s) unmerged`;

	for (let attempt = 1; attempt <= maxCheapFixRetries; attempt += 1) {
		onProgress?.(`integrate: conflict resolution attempt ${attempt} of ${maxCheapFixRetries} — ${paths.join(', ')}`);

		const refusal = await invokeShipIntegrator({ cwd, integration, branch, defaultBranch, standards, conflictPaths: paths });
		const unsettled = await readUnsettledPaths({ cwd });

		if ('error' in unsettled) {
			return unreadable({ detail: unsettled.error });
		}

		if (unsettled.paths.length === 0) {
			onProgress?.('integrate: the merge is fully settled');

			return undefined;
		}

		paths = unsettled.paths;
		detail = `${paths.join(', ')} — ${unsettled.reason}${refusal === undefined ? '' : `; the attempt reported: ${refusal}`}`;
	}

	return { reason: ShipBlockReason.IntegrationConflict, detail, paths };
};
