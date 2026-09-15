import { join } from 'node:path';
import type { StandardsReader } from '#src/common/types/StandardsReader.ts';
import { readDependencyNames } from '#src/common/workspace/readDependencyNames.ts';

/** A channel activates when ANY scoped package depends on one of its signal packages. */
const channelSignals: Record<string, string[]> = {
	react: ['react', 'preact', 'react-dom'],
	tanstack: ['@tanstack/react-start', '@tanstack/start'],
	nestjs: ['@nestjs/core'],
};

interface Params {
	reader?: StandardsReader;
	includeRoot?: boolean;
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
 * Legacy callers tolerate unreadable manifests; an observed reader makes unavailable
 * scoped manifests actionable errors. includeRoot composes root and package frameworks.
 */
export const detectStandardsChannels = async ({ cwd, packagesDir, packages, reader, includeRoot = false }: Params): Promise<string[]> => {
	const manifestPaths = [
		...(packages.length === 0 || includeRoot ? [join(cwd, 'package.json')] : []),
		...packages.map((name) => join(cwd, packagesDir, name, 'package.json')),
	];
	const dependencies = new Set<string>();

	for (const manifestPath of manifestPaths) {
		for (const name of (await readDependencyNames({
			manifestPath,
			reader,
			...(reader === undefined ? {} : { required: manifestPath !== join(cwd, 'package.json') }),
		})) ?? []) {
			dependencies.add(name);
		}
	}

	return Object.entries(channelSignals)
		.filter(([, signals]) => signals.some((signal) => dependencies.has(signal)))
		.map(([channel]) => channel);
};
