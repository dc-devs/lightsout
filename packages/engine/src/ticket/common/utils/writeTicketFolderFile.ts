import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface Params {
	/** The file's own path inside the primary checkout's ticket folder. */
	path: string;
	content: Buffer;
}

/**
 * Write one of a ticket folder's own files — the record, the sidecar, a
 * surfaced published copy — off to the side and expose it with one rename, the
 * way `writeBranchState` writes its record.
 *
 * The temporary name is fixed rather than unique because every caller holds the
 * record's exclusive lock, which is what makes two writers of one path
 * impossible. A failure throws: the callers turn it into their own one sentence
 * with `messageOf`, because what the failure means differs by what was being
 * written.
 */
export const writeTicketFolderFile = async ({ path, content }: Params): Promise<void> => {
	const temporaryPath = `${path}.tmp`;

	await mkdir(dirname(path), { recursive: true });
	await writeFile(temporaryPath, content);
	await rename(temporaryPath, path);
};
