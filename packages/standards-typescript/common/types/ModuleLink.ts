/** One `import … from` or `export … from` line, with its specifier already resolved. */
export interface ModuleLink {
	/** True for `export type { … } from` and `import type { … } from` — the whole statement, not a per-name `type` modifier. */
	typeOnly: boolean;
	/** True when the line re-exports (`export … from`) rather than imports. A barrel's surface is its re-export lines; a re-export is also a consumption of what it points at. */
	reExport: boolean;
	/** Repo-relative path the specifier resolves to, or undefined when it left the repo or could not be placed — `resolved` tells those two apart. */
	target?: string;
	/** False when the compiler could not place the specifier at all. A rule arguing from a name's ABSENCE has to stand down on an unresolved line. */
	resolved: boolean;
	/** True for `export * from` and `import * as x` — the whole surface, with no names written down. */
	star: boolean;
	/** Each named specifier: `from` is the name in the target module, `as` is the name this file binds or publishes. */
	names: Array<{ from: string; as: string }>;
}
