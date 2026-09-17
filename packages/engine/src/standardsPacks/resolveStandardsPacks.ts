import { isAbsolute, resolve } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/common/types/LoadedStandardsPack.ts';
import { readStandardsPack } from '#src/standardsPacks/readStandardsPack.ts';
import { resolveDefaultStandardsPack } from '#src/standardsPacks/resolveDefaultStandardsPack.ts';

interface Params {
	cwd: string;
	config?: LightsoutConfig;
}

/** The roots the config asks for, absolute — its three-way meaning stated once. */
const resolveRoots = ({ cwd, standardsPacks }: { cwd: string; standardsPacks: string[] | false | undefined }) => {
	if (standardsPacks === false) {
		return [];
	}

	if (standardsPacks === undefined) {
		return [resolveDefaultStandardsPack()];
	}

	return standardsPacks.map((entry) => (isAbsolute(entry) ? entry : resolve(cwd, entry)));
};

/**
 * Rule ids collide across packs exactly as they collide inside one: a config
 * override or a site key naming the id would be ambiguous. Each pack validated
 * itself at load, so anything left here is a cross-pack clash.
 */
const findCrossPackDuplicates = ({ packs }: { packs: LoadedStandardsPack[] }) => {
	const owners = new Map<string, LoadedStandardsPack>();
	const duplicates: string[] = [];

	for (const pack of packs) {
		for (const rule of pack.rules) {
			const owner = owners.get(rule.id);

			if (owner === undefined) {
				owners.set(rule.id, pack);
			} else {
				duplicates.push(`duplicate rule id "${rule.id}": claimed by ${owner.name} (${owner.rootPath}) and ${pack.name} (${pack.rootPath})`);
			}
		}
	}

	return duplicates;
};

/**
 * Load every standards pack a run works against — the one place the config's
 * three-way meaning is encoded: unspecified = the pack the plugin ships
 * (announced, never silent), `false` = explicitly none, an array = exactly
 * these roots, each resolved against the consumer repo unless already absolute.
 *
 * Packs load in the order listed, one at a time, so the first bad root is the
 * one reported. Loading is left to throw — a consumer that declared standards
 * and did not get them must not run.
 *
 * @param cwd - the consumer repo, which relative pack roots resolve against
 * @param config - the consumer's config; absent means the bundled default pack
 * @throws {Error} When a declared pack cannot be loaded, or two loaded packs claim one rule id.
 */
export const resolveStandardsPacks = async ({ cwd, config }: Params): Promise<LoadedStandardsPack[]> => {
	const roots = resolveRoots({ cwd, standardsPacks: config?.['standards-packs'] });
	const packs: LoadedStandardsPack[] = [];

	for (const packPath of roots) {
		packs.push(await readStandardsPack({ packPath }));
	}

	const duplicates = findCrossPackDuplicates({ packs });

	if (duplicates.length > 0) {
		throw new Error(`standards packs disagree about rule ids:\n${duplicates.map((duplicate) => `- ${duplicate}`).join('\n')}`);
	}

	return packs;
};
