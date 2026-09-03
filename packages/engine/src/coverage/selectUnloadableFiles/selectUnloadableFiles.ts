import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type ts from 'typescript';
import { isUnloadableSourceFile } from '#src/common/sourceFiles/isUnloadableSourceFile.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { coverageScopeOf } from '#src/coverage/common/utils/coverageScopeOf.ts';
import { resolveScopeContext } from '#src/coverage/common/utils/resolveScopeContext.ts';
import { scopeRootOf } from '#src/coverage/common/utils/scopeRootOf.ts';
import { loadScopeJestConfig } from '#src/coverage/loadScopeJestConfig/index.ts';
import type { JestModuleMode } from '#src/coverage/selectUnloadableFiles/common/types/JestModuleMode.ts';
import { isEsmSourceFile } from '#src/coverage/selectUnloadableFiles/common/utils/isEsmSourceFile.ts';
import { readJestModuleMode } from '#src/coverage/selectUnloadableFiles/common/utils/readJestModuleMode.ts';
import { readNearestPackageType } from '#src/coverage/selectUnloadableFiles/common/utils/readNearestPackageType.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Repo-relative candidate files to split. */
	files: string[];
	/** The consumer's TypeScript module, or undefined — without one nothing is classified unloadable. */
	compiler: typeof ts | undefined;
}

/**
 * Split candidate files by whether the repo's own test runner could load them
 * at all: a file holding an `await` at module scope is unloadable exactly when
 * the Jest configuration governing its coverage scope loads that file as
 * CommonJS, where a module-scope `await` is a syntax error and no test can
 * execute a statement of it.
 *
 * One function answers this for every caller on purpose. The execution gate and
 * the write-tests target selection ask the same question, and two copies of it
 * are exactly how a writer gets asked for a test the gate would then exempt.
 * That is also why each file's content is read here rather than taken from the
 * caller: a caller-supplied content map is a seam for exactly the disagreement
 * this split exists to rule out, and a run classifies tens of changed files.
 *
 * Every uncertain answer keeps the file unloadable — no configuration found,
 * one the engine cannot evaluate, a file in no coverage scope. That is the
 * behaviour that ships today, and it is the safe direction: a wrong ESM verdict
 * fails a run on a file no test could ever cover, while a wrong CommonJS
 * verdict merely repeats today's silent skip.
 */
export const selectUnloadableFiles = async ({ cwd, config, files, compiler }: Params): Promise<{ loadable: string[]; unloadable: string[] }> => {
	if (compiler === undefined) {
		return { loadable: files, unloadable: [] };
	}

	const { root, packagesDir, monorepo, scopes } = await resolveScopeContext({ cwd, config });
	// Two maps rather than one composite key: the Jest configuration load is the
	// expensive half and is genuinely per scope, while the manifest walk is cheap
	// and genuinely per directory.
	const modes = new Map<string, JestModuleMode | undefined>();
	const packageTypes = new Map<string, string | undefined>();
	const loadable: string[] = [];
	const unloadable: string[] = [];

	for (const file of files) {
		const content = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (content === undefined || !isUnloadableSourceFile({ path: file, content, compiler })) {
			// An unreadable file keeps the caller's own handling of it, and a file
			// with no module-scope `await` loads under either module system.
			loadable.push(file);
			continue;
		}

		const scope = coverageScopeOf({ file, scopes, packagesDir, monorepo });

		if (scope === undefined) {
			// No Jest configuration governs this file, so its module mode is
			// undetermined — which keeps the exemption that ships today.
			unloadable.push(file);
			continue;
		}

		const scopeRoot = scopeRootOf({ root, scope: scope.scope, packagesDir, monorepo });

		if (!modes.has(scope.scope)) {
			modes.set(scope.scope, readJestModuleMode({ loaded: await loadScopeJestConfig({ scopeRoot, command: scope.command }) }));
		}

		const fileDir = dirname(join(root, file));

		if (!packageTypes.has(fileDir)) {
			packageTypes.set(fileDir, await readNearestPackageType({ fileDir, scopeRoot }));
		}

		const esm = isEsmSourceFile({ path: file, moduleMode: modes.get(scope.scope), packageType: packageTypes.get(fileDir) });

		(esm ? loadable : unloadable).push(file);
	}

	return { loadable, unloadable };
};
