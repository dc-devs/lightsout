import { readPackageDependencies } from '#src/common/workspace/readPackageDependencies.ts';
import type { FrameworkFacts, LightsoutConfig } from '#src/contracts/index.ts';
import { importFrameworksModule } from '#src/standardsPacks/common/utils/importFrameworksModule.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/resolveStandardsPacks.ts';

interface Params {
	cwd: string;
	/** Monorepo package parent dir (config `packages-dir`, default 'packages'). */
	packagesDir: string;
	config?: LightsoutConfig;
}

/**
 * What the repo's own standards pack says its frameworks own — the engine's one
 * door to those facts, for the mirrors it keeps of pack logic.
 *
 * The packs are resolved the same three-way way every other consumer resolves
 * them, so a repo pointed at its own pack is answered by its own pack. Packs
 * load in the order listed, and the first one shipping a framework-facts module
 * answers; a pack that ships none is the supported silent case — the mirrors go
 * on knowing nothing, exactly as they did before this surface existed.
 *
 * A pack that declares the module and cannot supply it is a different thing, so
 * load failures propagate: a half-informed mirror would map boundaries the rules
 * do not.
 *
 * No caching layer. The two pipeline call sites each call this once, and the
 * dynamic import underneath is deduplicated by Node's own module cache, so a
 * memo would be machinery without a job.
 *
 * @param cwd - the consumer repo, which relative pack roots resolve against
 * @param config - the consumer's config; absent means the bundled default pack
 * @throws {Error} When a declared pack cannot be loaded, or ships a frameworks module it cannot supply.
 */
export const getPackFrameworkFacts = async ({ cwd, packagesDir, config }: Params): Promise<FrameworkFacts> => {
	const packs = await resolveStandardsPacks({ cwd, config });
	const modulePath = packs.find((pack) => pack.frameworksModulePath !== undefined)?.frameworksModulePath;

	if (modulePath === undefined) {
		return { isFrameworkLoadedFile: () => false };
	}

	const { getFrameworkFacts } = await importFrameworksModule({ modulePath });

	return getFrameworkFacts({ dependencies: await readPackageDependencies({ cwd, packagesDir }) });
};
