/**
 * One package's framework mandates — over folders and over files alike — and the
 * directory that earned them.
 *
 * Rule after rule ends its prose with the same carve-out: where the package's
 * framework doc mandates a name, a layout or an entry point, the framework doc
 * wins. Holding that sentence as one shape is what keeps it from becoming a
 * judgement each rule makes for itself. The directory rides along because a rule
 * also needs to know which `src/` the mandates apply inside: a monorepo with a
 * NestJS API and a React front end gets each package's own answer rather than
 * the union.
 */
export interface FrameworkCarveOut {
	/** Package directory whose declared dependencies earned these exemptions ('.' for the repo root). */
	directory: string;
	/**
	 * Files the framework resolves by convention, written relative to the
	 * package's `src/` — e.g. TanStack Start's `router.tsx`, `server.ts` and
	 * `client.tsx`, or NestJS's `main.ts`.
	 *
	 * A framework names these files itself and reaches them without an import,
	 * so a check reading exports sees no consumer and a check reading filenames
	 * sees a name that matches no export. Both are facts about the framework,
	 * not about the author, which is why they are recorded here rather than
	 * guessed per rule.
	 */
	entryFiles: string[];
	/**
	 * Folder names this package's framework mandates, exempt from the
	 * banned-name rule.
	 *
	 * No framework in today's table fills this, and that is deliberate rather
	 * than an omission: React mandates no folder structure and NestJS wires by
	 * decorators rather than by directory, so `components/`, `hooks/`,
	 * `controllers/` and their siblings are conventions projects adopt, not
	 * mandates their frameworks state. What a repo prefers its folders be called
	 * is not what fills this — only what a framework's own documents require.
	 * The field stays so the rule that would need it already asks, and a real
	 * mandate is one table entry away.
	 */
	exemptFolderNames: string[];
	/** True when the framework mandates kebab-case folders throughout (NestJS). */
	kebabCase: boolean;
	/** Route directory names whose segments are URL-mapped and therefore kebab-case by mandate. */
	routerRoots: string[];
}
