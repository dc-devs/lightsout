import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Jest's own resolution order for a config file at a root, minus the dialects
// a CommonJS require cannot evaluate.
const configFileNames = ['jest.config.cjs', 'jest.config.js', 'jest.config.mjs', 'jest.config.json'];

const exists = ({ path }: { path: string }) =>
	stat(path).then(
		() => true,
		() => false,
	);

const configArgument = ({ command }: { command: string }) => {
	const tokens = command.split(/\s+/).filter((token) => token !== '');
	const flagIndex = tokens.findIndex((token) => token === '-c' || token === '--config');
	const inline = tokens.find((token) => token.startsWith('--config='));
	const raw = flagIndex === -1 ? inline?.slice('--config='.length) : tokens[flagIndex + 1];

	return raw === undefined ? undefined : raw.replace(/^["']|["']$/g, '');
};

const hasJestKey = async ({ manifestPath }: { manifestPath: string }) => {
	try {
		const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));

		return typeof parsed === 'object' && parsed !== null && 'jest' in parsed;
	} catch {
		return false;
	}
};

interface Params {
	/** Absolute path to the scope's root directory (the repo root, or `<packagesDir>/<scope>`). */
	scopeRoot: string;
	/** The command that runs coverage for this scope, already resolved through any `… run <script>` indirection (e.g. `jest -c jest.config.cjs --coverage`), or undefined when it could not be read. */
	coverageScript: string | undefined;
}

/**
 * The absolute path of the Jest configuration a scope's coverage command
 * actually runs, or undefined when none can be identified.
 *
 * The command's own `-c` / `--config` argument wins outright — and when it
 * names a file that is not there, the answer is undefined rather than a
 * guess. Every package in this workspace ships both a unit config and an e2e
 * one, so picking by filename where the command already said which is how the
 * wrong suite's exclusions get read.
 */
export const resolveJestConfigPath = async ({ scopeRoot, coverageScript }: Params): Promise<string | undefined> => {
	const named = coverageScript === undefined ? undefined : configArgument({ command: coverageScript });

	if (named !== undefined) {
		const path = resolve(scopeRoot, named);

		return (await exists({ path })) ? path : undefined;
	}

	let found: string | undefined;

	for (const name of configFileNames) {
		if (found === undefined && (await exists({ path: join(scopeRoot, name) }))) {
			found = join(scopeRoot, name);
		}
	}

	if (found !== undefined) {
		return found;
	}

	const manifestPath = join(scopeRoot, 'package.json');

	return (await hasJestKey({ manifestPath })) ? manifestPath : undefined;
};
