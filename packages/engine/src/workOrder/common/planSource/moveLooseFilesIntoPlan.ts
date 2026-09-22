import { rename, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';

interface Params {
	/** The source's plans folder, which holds the loose files. */
	plansFolder: string;
	/** The new plan's own folder, which the caller has already created. */
	planFolder: string;
	/** The loose entries to move, in the order they are to be taken. */
	entries: string[];
	/** Whether the emptied source may be taken away with its files — never set when the source is the ticket's own folder. */
	retire: boolean;
}

/**
 * Move the source's loose files into the new plan's folder, wholly or not at
 * all.
 *
 * A part-way move is put back here rather than by the caller, so "wholly moved
 * or exactly as it was found" is one file's invariant and cannot be assembled
 * wrongly. The put-back never removes the plan's folder and never deletes
 * anything: the plan legitimately exists by now, an empty plan folder is what an
 * add without `--from` creates anyway, and whatever stood in the move's way is
 * the human's.
 *
 * The emptied source is retired the way a rename leaves nothing behind — its
 * `plans/` folder and the work order folder above it, each non-recursively and each
 * ignoring its own failure, so a source still holding a `runs/` folder, a record
 * or a file someone put there is left exactly as it was found.
 */
export const moveLooseFilesIntoPlan = async ({ plansFolder, planFolder, entries, retire }: Params): Promise<{ error: string } | undefined> => {
	const moved: string[] = [];
	let failure: { error: string } | undefined;

	try {
		for (const entry of entries) {
			await rename(join(plansFolder, entry), join(planFolder, entry));
			moved.push(entry);
		}
	} catch (error) {
		failure = {
			error: `the loose files of '${plansFolder}' could not all be moved into ${planFolder}, so every one of them is back in ${plansFolder}: ${messageOf({ error })}`,
		};
	}

	if (failure !== undefined) {
		for (const entry of moved) {
			await rename(join(planFolder, entry), join(plansFolder, entry)).catch(() => undefined);
		}
	} else if (retire) {
		await rmdir(plansFolder).catch(() => undefined);
		await rmdir(dirname(plansFolder)).catch(() => undefined);
	}

	return failure;
};
