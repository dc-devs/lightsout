/**
 * The framework questions a standards pack answers for the engine's own mirrors
 * of its logic.
 *
 * The engine keeps copies of a few pack helpers — `collectFolderModules` mirrors
 * `mapFolderModules` — because a pack ships as a bare directory with no
 * `node_modules`, so neither side can import the other. What the engine must not
 * copy is the pack's dependency-to-mandate table: which framework owns what is
 * standards content, and a second table beside the engine would drift from the
 * pack a repo actually configured. So the logic is mirrored and the facts are
 * asked for, through this shape.
 *
 * Deliberately narrow: a member exists here only once an engine-side mirror
 * needs it.
 */
export interface FrameworkFacts {
	/** Whether the framework reaches this file itself — a route file, or a convention-resolved entry file. */
	isFrameworkLoadedFile: (params: { path: string }) => boolean;
}
