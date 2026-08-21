/**
 * One folder whose barrel marks a boundary: where that barrel lives, and the files it makes public.
 *
 * @mirrors packages/engine/src/common/types/FolderModule.ts
 */
export interface FolderModule {
	/** Repo-relative path of the folder's `index.ts` — named when a rule asks for the barrel to be edited. */
	barrelPath: string;
	/** Repo-relative paths the barrel re-exports. */
	exportedTargets: Set<string>;
}
