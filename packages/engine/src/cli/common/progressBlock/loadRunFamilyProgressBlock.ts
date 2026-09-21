import { loadRunProgressBlock } from '#src/cli/common/progressBlock/loadRunProgressBlock.ts';
import { getRunFamilyRoot } from '#src/cli/common/runFamily/getRunFamilyRoot.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { listRuns } from '#src/views/index.ts';

interface Params {
	cwd: string;
	/** The run the caller settled on — a coordinator, or the phase child that is moving. The loader climbs to the coordinator itself. */
	runId: string;
}

/**
 * One run family's progress as lines: the coordinator's block, a blank line,
 * then one phase child's block — the phase that is going, or the most recently
 * updated one between phases and after the last of them.
 *
 * It takes the run the caller CHOSE rather than a family root, because climbing
 * is the one step a corrupt coordinator has to be guarded against: a root whose
 * manifest will not read is skipped in silence by `listRuns`, and the chosen run
 * stands alone rather than taking the whole update down with it. Both callers
 * hold the run they chose, so one contract serves both and neither can forget
 * the guard.
 *
 * It prints nothing, so a caller can place the lines wherever they belong — at
 * the terminal, or inside a fence.
 *
 * @throws {RunNotFoundError} When no run on disk answers to the given id.
 */
export const loadRunFamilyProgressBlock = async ({ cwd, runId }: Params): Promise<string[]> => {
	const listings = await listRuns({ cwd });
	const chosen = listings.find((run) => run.runId === runId);
	// Only a root a readable listing answers to is climbed to: without one the
	// coordinator's manifest is corrupt or half-written, and the run the caller
	// chose is the whole honest answer.
	const named = chosen === undefined ? runId : getRunFamilyRoot({ run: chosen });
	const root = listings.some((run) => run.runId === named) ? named : runId;
	const children = listings.filter((run) => run.runId !== root && getRunFamilyRoot({ run }) === root);
	const going = children.find((run) => run.status === RunStatus.Running || run.status === RunStatus.Pending);
	// `listRuns` answers newest updated first, so the first child is the most
	// recently updated one — which is what the gap between phases shows.
	const child = going ?? children[0];
	const { lines } = await loadRunProgressBlock({ cwd, runId: root });

	return child === undefined ? lines : [...lines, '', ...(await loadRunProgressBlock({ cwd, runId: child.runId })).lines];
};
