/**
 * One folder whose barrel marks a boundary: where that barrel lives, and the
 * files it makes public.
 *
 * Deliberately mirrors the standards package's type of the same name rather
 * than sharing it: that package computes boundaries from supplied file text
 * and this one from disk plus the consumer's compiler, so a shared type would
 * couple a pure text analyzer to engine I/O. The two definitions must agree on
 * what "public" means — the rule owns that meaning — but never on how they get
 * there.
 *
 * @mirrors packages/standards-typescript/common/types/FolderModule.ts
 */
export interface FolderModule {
	/** Repo-relative path of the folder's index.ts. */
	barrelPath: string;
	/** Repo-relative paths the barrel re-exports. */
	exportedTargets: Set<string>;
}
