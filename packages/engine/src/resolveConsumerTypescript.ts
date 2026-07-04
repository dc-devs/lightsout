import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type ts from 'typescript';

interface Params {
	cwd: string;
	/** Monorepo package parent dir (default 'packages') — pnpm workspaces keep typescript in package node_modules, not the root. */
	packagesDir?: string;
}

/**
 * The target repo's own TypeScript module, or undefined when it has none.
 * Bundling the compiler into the committed CLI bundle would add ~8MB for a
 * dependency every TS consumer already has — so the AST tier borrows the
 * consumer's and degrades honestly when absent (JS-only repos). Tries the
 * repo root first, then each workspace package (pnpm hoists nothing by
 * default, so the root often has no typescript while every package does).
 */
export const resolveConsumerTypescript = ({ cwd, packagesDir = 'packages' }: Params) => {
	let packageNames: string[] = [];

	try {
		packageNames = readdirSync(join(cwd, packagesDir)).filter((name) => !name.startsWith('.'));
	} catch {
		// not a monorepo — root-only resolution below
	}

	const manifests = [join(cwd, 'package.json'), ...packageNames.map((name) => join(cwd, packagesDir, name, 'package.json'))];

	for (const manifest of manifests) {
		try {
			return createRequire(manifest)('typescript') as typeof ts;
		} catch {
			continue;
		}
	}

	return undefined;
};
