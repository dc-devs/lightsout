import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	/** Absolute path to the mailbox directory. */
	directory: string;
}

/**
 * The mailbox, existing and empty.
 *
 * A question file left by a crashed drain names a worker that is gone, so it
 * would sit in the mailbox looking answerable forever. Emptying at startup is
 * what makes "a file in the mailbox" mean "a live question".
 */
export const emptyRelayMailbox = async ({ directory }: Params): Promise<void> => {
	await mkdir(directory, { recursive: true });

	const entries = await readdir(directory);

	await Promise.all(entries.map((entry) => rm(join(directory, entry), { force: true, recursive: true })));
};
