/**
 * The path aliases one package declares, ready to resolve against — from
 * either place a package may declare them: its `package.json` → `imports`, or
 * its `tsconfig.json` → `compilerOptions.paths`.
 *
 * `base` is where the targets are anchored: the manifest's own folder for the
 * `imports` form, and for a tsconfig its `baseUrl` when the file declares one,
 * else the config's own folder, which is what TypeScript does.
 */
export interface PathAliases {
	/** Repo-relative folder the target patterns are anchored to. */
	base: string;
	/** Alias pattern (`#src/*`, `@/*`) to the target patterns it maps to (`./src/*`), in declaration order. */
	patterns: Map<string, string[]>;
}
