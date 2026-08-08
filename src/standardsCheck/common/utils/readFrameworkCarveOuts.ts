import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { FrameworkCarveOut } from '@/standardsCheck/common/types/FrameworkCarveOut';
import { collectDirectories } from '@/standardsCheck/common/utils/collectDirectories';

const Manifest = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
});

/**
 * Each carve-out keyed on the dependency that earns it. A framework mandate is a
 * fact about a package's manifest, never a guess from what its folders hold — so
 * adding a framework costs one entry here and nothing else.
 *
 * `components/` and `hooks/` are React's own feature layout; `controllers/`,
 * `models/` and `services/` are NestJS's, which also mandates kebab-case
 * throughout; each router package names the directory whose segments become URL
 * path segments and are therefore kebab-case by mandate.
 */
const carveOutSignals: Record<string, Partial<FrameworkCarveOut>> = {
	react: { exemptFolderNames: ['components', 'hooks'] },
	'react-dom': { exemptFolderNames: ['components', 'hooks'] },
	'@nestjs/core': { exemptFolderNames: ['controllers', 'models', 'services'], kebabCase: true },
	next: { routerRoots: ['app', 'pages'] },
	'@tanstack/react-router': { routerRoots: ['routes'] },
	'@remix-run/react': { routerRoots: ['routes'] },
	'expo-router': { routerRoots: ['app'] },
};

/** The dependency names one manifest declares, or undefined when there is no readable manifest there. */
const readDependencyNames = async ({ path }: { path: string }) => {
	try {
		const manifest = Manifest.parse(JSON.parse(await readFile(path, 'utf8')));

		return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
	} catch {
		return undefined;
	}
};

interface Params {
	cwd: string;
	/** Repo-relative source files — their nearest package.json is what a carve-out is read from. */
	files: string[];
}

/**
 * Which folder-name and folder-casing exemptions this repo's frameworks earn.
 *
 * Both `folder-structure.md`'s banned-name list and its casing rules end with
 * the same carve-out: where the package's framework doc mandates a name, the
 * framework doc wins. The only mechanical statement of which framework a package
 * uses is its manifest's dependency list, so that is what this reads — never a
 * heuristic on folder contents.
 *
 * Returns exemptions per package directory (the repo root is `.`), so a monorepo
 * with a NestJS API and a React front end gets each package's own carve-outs
 * rather than the union. A directory with no readable manifest gets no entry at
 * all, and the paths it owns fall to the nearest one that has — or, when nothing
 * does, to the doc's plain defaults.
 */
export const readFrameworkCarveOuts = async ({ cwd, files }: Params): Promise<Map<string, FrameworkCarveOut>> => {
	const carveOuts = new Map<string, FrameworkCarveOut>();

	// The repo root joins the walk because a non-monorepo's only manifest sits there.
	for (const directory of ['.', ...collectDirectories({ files })].sort()) {
		const dependencies = await readDependencyNames({ path: join(cwd, directory, 'package.json') });

		if (dependencies === undefined) {
			continue;
		}

		const signals = Object.entries(carveOutSignals).filter(([name]) => dependencies.includes(name));

		carveOuts.set(directory, {
			exemptFolderNames: [...new Set(signals.flatMap(([, carveOut]) => carveOut.exemptFolderNames ?? []))],
			kebabCase: signals.some(([, carveOut]) => carveOut.kebabCase === true),
			routerRoots: [...new Set(signals.flatMap(([, carveOut]) => carveOut.routerRoots ?? []))],
		});
	}

	return carveOuts;
};
