/**
 * One package's exemptions from the folder rules, and the directory that earned
 * them.
 *
 * Both the banned-name rule and the casing rule end their prose with the same
 * carve-out — where the package's framework doc mandates a name, the framework
 * doc wins — so both read this shape. The directory rides along because the
 * rules also need to know which `src/` the exemptions apply inside: a monorepo
 * with a NestJS API and a React front end gets each package's own answer rather
 * than the union.
 */
export interface FrameworkCarveOut {
	/** Package directory whose declared dependencies earned these exemptions ('.' for the repo root). */
	directory: string;
	/** Folder names this package's framework mandates, exempt from the banned-name rule. */
	exemptFolderNames: string[];
	/** True when the framework mandates kebab-case folders throughout (NestJS). */
	kebabCase: boolean;
	/** Route directory names whose segments are URL-mapped and therefore kebab-case by mandate. */
	routerRoots: string[];
	/**
	 * Folder shapes the framework mandates as modules, written relative to the
	 * package's `src/` with `*` standing for one segment — e.g.
	 * a TanStack Start screen is `features`, any name, `screens`, any name.
	 *
	 * A module here is declared, not inferred. The barrel-omission test asks
	 * whether a barrel hides anything, which reads a one-file folder as a
	 * convenience rather than a boundary — true of a folder someone made up, and
	 * false of one the framework requires and which grows its own `components/`
	 * and `hooks/` as the screen does.
	 */
	moduleFolders: string[];
}
