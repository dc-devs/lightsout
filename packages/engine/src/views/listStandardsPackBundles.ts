import { isAbsolute, resolve } from 'node:path';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { StandardsPackBundle } from '#src/contracts/index.ts';
import { resolveAuthoredStandardsPack, resolveDefaultStandardsPack } from '#src/standardsPacks/index.ts';
import { standardsPackBundleCache } from '#src/views/common/constants/standardsPackBundleCache.ts';

/** One pack root to read, and whether it is the pack a run loads when the config names none. */
interface PackRoot {
	packPath: string;
	isDefault: boolean;
}

/**
 * The roots this repo loads, or none — never a throw.
 *
 * A page has to render on a machine with no config, no repo and no authored pack
 * beside it, so every way of ending up with nothing is answered with an empty
 * list and a line in the server log. The run-time `resolveStandardsPacks` keeps
 * the opposite stance, which is correct there: a run that declared standards and
 * did not get them must not proceed.
 */
const resolvePackRoots = async ({ cwd }: { cwd: string }) => {
	let roots: PackRoot[] = [];

	try {
		const configured = (await readOptionalConfig({ cwd }))?.['standards-packs'];

		if (configured === undefined) {
			// The authored folder when one is beside `cwd`, else the copy the engine
			// ships — which carries no fixtures, and whose `built` says so.
			roots = [{ packPath: resolveAuthoredStandardsPack({ cwd }) ?? resolveDefaultStandardsPack(), isDefault: true }];
		} else if (configured !== false) {
			roots = configured.map((entry) => ({ packPath: isAbsolute(entry) ? entry : resolve(cwd, entry), isDefault: false }));
		}
	} catch (error) {
		console.warn(`standards packs could not be listed for ${cwd}: ${messageOf({ error })}`);
	}

	return roots;
};

interface Params {
	cwd: string;
}

/**
 * Every standards pack this repo loads, read whole from its folder — the source
 * the three pack views project from.
 *
 * A pack that will not load is skipped with a line in the server log rather than
 * failing the page: the viewer says what it could find, and the person who can
 * fix the pack is the one reading the server's output. Two packs claiming one
 * name are the same case, because the name is what a URL addresses a pack by —
 * the first one listed wins and the second is named in the log.
 *
 * @param cwd - the repo whose config decides which packs load, and which relative pack roots resolve against
 */
export const listStandardsPackBundles = async ({ cwd }: Params): Promise<StandardsPackBundle[]> => {
	const bundles: StandardsPackBundle[] = [];
	const claimed = new Map<string, string>();

	for (const { packPath, isDefault } of await resolvePackRoots({ cwd })) {
		const bundle = await standardsPackBundleCache.read({ packPath, isDefault, cwd }).catch((error: unknown) => {
			console.warn(`standards pack at ${packPath} could not be read: ${messageOf({ error })}`);

			return undefined;
		});
		if (bundle === undefined) {
			continue;
		}

		const owner = claimed.get(bundle.name);

		if (owner === undefined) {
			claimed.set(bundle.name, bundle.rootPath);
			bundles.push(bundle);
		} else {
			console.warn(`standards pack name "${bundle.name}" is claimed by ${owner} and ${bundle.rootPath} — the second one is left out`);
		}
	}

	return bundles;
};
