import { realpath } from 'node:fs/promises';

interface Params {
	path: string;
	otherPath: string;
}

/**
 * Whether two spellings name the same directory.
 *
 * Git answers filesystem-resolved paths while the worktree layout is composed
 * from the checkout as the caller spelled it, so wherever a checkout sits behind
 * a symlink the two spellings of one tree differ — the reason `toQueuePath` in
 * `scanParkedWorktrees` gives. Both sides go through `realpath`, with the
 * literal path as the fallback for one that does not exist yet.
 */
export const isSamePath = async ({ path, otherPath }: Params): Promise<boolean> => {
	const [real, otherReal] = await Promise.all([path, otherPath].map((candidate) => realpath(candidate).catch(() => candidate)));

	return real === otherReal;
};
