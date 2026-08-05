import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const Manifest = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
});

/** A channel activates when ANY scoped package depends on one of its signal packages. */
const channelSignals: Record<string, string[]> = {
	react: ['react', 'preact', 'react-dom'],
	tanstack: ['@tanstack/react-start', '@tanstack/start'],
};

interface Params {
	cwd: string;
	packagesDir: string;
	/** Package scope (directory names). Empty = non-monorepo → the root package.json decides. */
	packages: string[];
}

/**
 * Which framework standards channels apply to this run, detected from the
 * scoped packages' package.json dependencies — a terraform package never
 * pays the React-docs token tax, and a web package gets them without any
 * config. Consumers can override with `standardsChannels` in the config.
 * Unreadable manifests contribute nothing (the packages themselves fail
 * later, at gate time, with a better error).
 */
export const detectStandardsChannels = async ({ cwd, packagesDir, packages }: Params) => {
	const manifestPaths =
		packages.length > 0 ? packages.map((name) => join(cwd, packagesDir, name, 'package.json')) : [join(cwd, 'package.json')];
	const dependencies = new Set<string>();

	for (const path of manifestPaths) {
		try {
			const parsed = Manifest.parse(JSON.parse(await readFile(path, 'utf8')));

			for (const record of [parsed.dependencies, parsed.devDependencies, parsed.peerDependencies]) {
				for (const name of Object.keys(record ?? {})) {
					dependencies.add(name);
				}
			}
		} catch {
			// missing/invalid manifest — contributes no channels
		}
	}

	return Object.entries(channelSignals)
		.filter(([, signals]) => signals.some((signal) => dependencies.has(signal)))
		.map(([channel]) => channel);
};
