/**
 * The `compilerOptions.paths` of one tsconfig, ready to resolve against.
 *
 * `base` is where the targets are anchored: `baseUrl` when the file declares
 * one, else the tsconfig's own folder, which is what TypeScript does.
 */
export interface PathAliases {
	/** Repo-relative folder the target patterns are anchored to. */
	base: string;
	/** Alias pattern (`@/*`) to the target patterns it maps to (`./src/*`), in declaration order. */
	patterns: Map<string, string[]>;
}
