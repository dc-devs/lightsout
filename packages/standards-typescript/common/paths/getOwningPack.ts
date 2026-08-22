interface Params {
	/** A repo-relative path. */
	path: string;
	/** Repo-relative standards pack roots, as the input carries them. */
	standardsPacks: string[];
}

/**
 * Which shipped thing a file belongs to: the standards pack holding it, or
 * `.` for the repo's own code.
 *
 * A repo that authors standards holds two things that travel separately. The
 * engine, or the consumer's own application, is one. Each standards pack is
 * another — installed on its own, on machines where the rest of this repo is
 * absent, which is why a pack may import only from inside itself.
 *
 * The duplication rules need the distinction. Two identical functions in one
 * shipped thing are a defect, and deleting one fixes it. The same two either
 * side of this line cannot be shared at all: whichever copy you delete, one
 * side loses code it cannot import back. Reporting that pair asks for a change
 * nobody can make.
 *
 * The longest matching root wins, so a pack nested inside another belongs to
 * the nearer one.
 */
export const getOwningPack = ({ path, standardsPacks }: Params): string =>
	standardsPacks.filter((root) => path.startsWith(`${root}/`)).sort((first, second) => second.length - first.length)[0] ?? '.';
