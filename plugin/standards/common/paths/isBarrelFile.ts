import { getBaseName } from './getBaseName.ts';

/**
 * Every name a module system reads as a folder's entry point. The JavaScript
 * spellings earn their place: these rules judge paths rather than types, so
 * they run at full strength on a repo with no TypeScript in it, and a barrel
 * matched only as `.ts` would leave every such repo reading as barrel-less.
 */
const barrelName = /^index\.(m|c)?[jt]sx?$/;

interface Params {
	/** A repo-relative file path. */
	path: string;
}

/**
 * Whether a path NAMES a barrel — the question every rule that reads module
 * boundaries opens with, asked here once so no two of them disagree about
 * which spellings count.
 *
 * The name alone. A caller that also needs the file to actually export
 * something states that as its own condition beside this one, because the two
 * are different questions: an `index.ts` that only imports and runs is an
 * entry point, which is a fact about the file's contents, not its name.
 */
export const isBarrelFile = ({ path }: Params): boolean => barrelName.test(getBaseName({ path }));
