import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';

/**
 * Each carve-out keyed on the dependency that earns it. A framework mandate is
 * a fact about what a package declares it depends on, never a guess from what
 * its folders hold — so adding a framework costs one entry here and nothing
 * else.
 *
 * A row carries ONLY what the framework's own documents mandate: the folder a
 * router owns, the casing it imposes, the files it resolves by name. A layout
 * this repo prefers is never a row, however widely it is followed — React
 * mandates no folder structure, and NestJS wires by decorators rather than by
 * directory, so neither one's familiar vocabulary is a fact either of them
 * states. Mixing a preference in here is how a rule comes to concede to
 * something no framework ever asked for.
 */
const carveOutSignals: Record<string, Partial<Omit<FrameworkCarveOut, 'directory'>>> = {
	'@nestjs/core': { kebabCase: true, entryFiles: ['main.ts'] },
	next: { routerRoots: ['app', 'pages'] },
	'@tanstack/react-router': { routerRoots: ['routes'] },
	'@tanstack/react-start': { routerRoots: ['routes'], entryFiles: ['router.tsx', 'server.ts', 'client.tsx'] },
	'@remix-run/react': { routerRoots: ['routes'] },
	'expo-router': { routerRoots: ['app'] },
};

interface Params {
	/** Declared dependency names per package directory, exactly as the file-list input carries them. */
	dependencies: Map<string, string[]>;
}

/**
 * Which mandates each package's frameworks earn — over folder names and casing,
 * over which folders are modules, and over the files a framework resolves for
 * itself.
 *
 * The engine supplies the dependency facts; what counts as a carve-out is
 * standards content, so the tables live here. A package that declares no
 * framework this list knows still gets an entry — with no exemptions at all,
 * which is the doc's plain default rather than a gap.
 *
 * Ordered longest directory first, so a caller matching a path against these
 * entries takes the nearest manifest and reaches the repo root (`.`, which
 * matches every path) only last.
 */
export const getFrameworkCarveOuts = ({ dependencies }: Params): FrameworkCarveOut[] =>
	[...dependencies]
		.sort(([first], [second]) => second.length - first.length)
		.map(([directory, names]) => {
			const signals = Object.entries(carveOutSignals)
				.filter(([dependency]) => names.includes(dependency))
				.map(([, signal]) => signal);

			return {
				directory,
				entryFiles: [...new Set(signals.flatMap((signal) => signal.entryFiles ?? []))],
				exemptFolderNames: [...new Set(signals.flatMap((signal) => signal.exemptFolderNames ?? []))],
				kebabCase: signals.some((signal) => signal.kebabCase === true),
				routerRoots: [...new Set(signals.flatMap((signal) => signal.routerRoots ?? []))],
				moduleFolders: [...new Set(signals.flatMap((signal) => signal.moduleFolders ?? []))],
			};
		});
