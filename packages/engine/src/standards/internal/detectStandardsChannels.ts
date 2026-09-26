import { join } from 'node:path';
import { readDependencyNames } from '#src/common/workspace/readDependencyNames.ts';

/** A channel activates when ANY scoped package depends on one of its signal packages. */
const channelSignals: Record<string, string[]> = {
	react: ['react', 'preact', 'react-dom'],
	tanstack: ['@tanstack/react-start', '@tanstack/start'],
	nestjs: ['@nestjs/core'],
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
 * config. Consumers can override with `standards-channels` in the config.
 * Unreadable manifests contribute nothing (the packages themselves fail
 * later, at gate time, with a better error).
 */
export const detectStandardsChannels = async ({ cwd, packagesDir, packages }: Params): Promise<string[]> => {
	const manifestPaths = packages.length > 0 ? packages.map((name) => join(cwd, packagesDir, name, 'package.json')) : [join(cwd, 'package.json')];
	const dependencies = new Set<string>();

	for (const manifestPath of manifestPaths) {
		for (const name of (await readDependencyNames({ manifestPath })) ?? []) {
			dependencies.add(name);
		}
	}

	return Object.entries(channelSignals)
		.filter(([, signals]) => signals.some((signal) => dependencies.has(signal)))
		.map(([channel]) => channel);
};
