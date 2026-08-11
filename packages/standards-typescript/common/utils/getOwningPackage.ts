interface Params {
	/** A repo-relative path. */
	path: string;
	/** Repo-relative standards package roots, as the input carries them. */
	standardsPackages: string[];
}

/**
 * Which shipped thing a file belongs to: the standards package holding it, or
 * `.` for the repo's own code.
 *
 * A repo that authors standards holds two things that travel separately. The
 * engine, or the consumer's own application, is one. Each standards package is
 * another — installed on its own, on machines where the rest of this repo is
 * absent, which is why a package may import only from inside itself.
 *
 * The duplication rules need the distinction. Two identical functions in one
 * shipped thing are a defect, and deleting one fixes it. The same two either
 * side of this line cannot be shared at all: whichever copy you delete, one
 * side loses code it cannot import back. Reporting that pair asks for a change
 * nobody can make.
 *
 * The longest matching root wins, so a package nested inside another belongs to
 * the nearer one.
 */
export const getOwningPackage = ({ path, standardsPackages }: Params): string =>
	standardsPackages.filter((root) => path.startsWith(`${root}/`)).sort((first, second) => second.length - first.length)[0] ?? '.';
