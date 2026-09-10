import { lstat, mkdir, readlink, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { getFrictionPath, getReviewFindingsPath, getRunsDir } from '#src/runState/index.ts';
import { getShipResultPath } from '#src/ship/index.ts';

interface Params {
	/** The checkout the command was launched from — where every run record is written. */
	sourceCwd: string;
	/** The isolated worktree the run works in. */
	workspace: string;
}

/** One record place: where it really lives, where the workspace reaches it, and whether it is a directory. */
interface RecordLink {
	target: string;
	linkPath: string;
	directory: boolean;
}

/**
 * A throwaway branch name, handed to `getShipResultPath` only so its parent —
 * the ship-results directory — can be taken with `dirname`. Every branch name
 * answers the same parent, so the value itself carries no meaning; the ship
 * module publishes no directory helper of its own to ask instead.
 */
const unnamedBranch = 'unknown';

/** Every record place a run writes, in the launching checkout and in the workspace that reaches it. */
const recordLinks = ({ sourceCwd, workspace }: Params): RecordLink[] => [
	{ target: getRunsDir({ cwd: sourceCwd }), linkPath: getRunsDir({ cwd: workspace }), directory: true },
	{
		target: dirname(getShipResultPath({ cwd: sourceCwd, branch: unnamedBranch })),
		linkPath: dirname(getShipResultPath({ cwd: workspace, branch: unnamedBranch })),
		directory: true,
	},
	{ target: getFrictionPath({ cwd: sourceCwd }), linkPath: getFrictionPath({ cwd: workspace }), directory: false },
	{ target: getReviewFindingsPath({ cwd: sourceCwd }), linkPath: getReviewFindingsPath({ cwd: workspace }), directory: false },
];

/**
 * Place one link, or say what is standing where it belongs.
 *
 * A directory's target is created first, so nothing writing through the link
 * meets a dangling one. A ledger's target deliberately is not: an empty ledger
 * and no ledger are the same absence, and an appending write through a link
 * whose target is missing creates it.
 *
 * `lstat` rather than `realpath`, because a ledger link placed before its first
 * append is dangling by design and `realpath` cannot see one at all — which
 * would make a second call try to place a link that is already there.
 */
const linkOne = async ({ target, linkPath, directory }: RecordLink) => {
	if (directory) {
		await mkdir(target, { recursive: true });
	}

	const standing = await lstat(linkPath).catch(() => undefined);
	const linkedTo = standing?.isSymbolicLink() === true ? await readlink(linkPath).catch(() => undefined) : undefined;
	let failure: { error: string } | undefined;

	if (standing === undefined) {
		// `junction` is ignored off Windows and is what lets Windows link a
		// directory without elevation; a file link has no junction form.
		await symlink(target, linkPath, directory ? 'junction' : 'file');
	} else if (linkedTo === undefined || resolve(linkedTo) !== resolve(target)) {
		failure = {
			error: `${linkPath} already exists and is not a link to ${target}, so the run's records could not be kept in the checkout it was launched from`,
		};
	}

	return failure;
};

/**
 * Point the workspace's run-record places at the launching checkout's, so every
 * run record an isolated run writes lands in the checkout the command was
 * launched from.
 *
 * Four things are linked, and they are exactly what a reader in the launching
 * checkout reads back: the runs directory, the ship-results directory, and the
 * friction and judgment-findings ledgers. Linking rather than teaching each
 * reader to resolve the recorded workspace is what makes all four survive the
 * post-merge removal that takes the worktree down — reading through the
 * workspace would lose every one of them at exactly the moment a successful
 * ship removes that tree.
 *
 * The two ledgers are append-only and written with an appending open, which is
 * what makes one shared target safe when two worktrees of one repository each
 * hold a live run: the records interleave by run, which is what an accumulating
 * ledger is for, and each record's own provenance stamp says which run and step
 * wrote it.
 *
 * Nothing else in the lightsout state directory is linked. A copied plan is the
 * run's input rather than its record, and the run lock is per-checkout on
 * purpose — that is what lets two worktrees of one repository each hold a live
 * run.
 *
 * @returns undefined when every link is in place, or the one sentence saying which one is not
 */
export const linkRunRecords = async ({ sourceCwd, workspace }: Params): Promise<{ error: string } | undefined> => {
	let failure: { error: string } | undefined;

	try {
		await mkdir(join(workspace, '.lightsout'), { recursive: true });

		for (const link of recordLinks({ sourceCwd, workspace })) {
			failure = await linkOne(link);

			if (failure !== undefined) {
				break;
			}
		}
	} catch (error) {
		failure = { error: `the run's records could not be linked back to ${sourceCwd}: ${messageOf({ error })}` };
	}

	return failure;
};
