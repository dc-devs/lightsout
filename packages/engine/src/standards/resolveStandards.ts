import { type LightsoutConfig, StandardsSet } from '#src/contracts/index.ts';
import { detectStandardsChannels } from '#src/standards/detectStandardsChannels.ts';
import type { ResolvedStandards } from '#src/standards/ResolvedStandards.ts';
import { buildStandardsDocuments, resolveStandardsPacks } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Scoped packages whose dependencies decide the framework channels. Empty = base docs only. */
	packages: string[];
}

/**
 * Resolve both standards sets for a run: which packs the config asks for,
 * which framework channels apply, and the assembled text of each set.
 *
 * Assembly happens here, from the rule folders themselves, so no pre-built copy
 * exists anywhere to drift from the prose it was built from. Several packs
 * stack in the order the config lists them, each contributing to whichever sets
 * it carries. Both pipelines resolve standards the same way, and a rule this
 * easy to state slightly differently in two places is a rule that drifts.
 *
 * Loading is left to throw — a consumer that declared standards and did not get
 * them must not run, and each pipeline reports that failure in its own terms.
 *
 * @param cwd - the consumer repo
 * @param config - the consumer's config
 * @param packages - the run's package scope, which channel detection reads
 * @throws {Error} When a declared standards pack cannot be loaded.
 */
export const resolveStandards = async ({ cwd, config, packages }: Params): Promise<ResolvedStandards> => {
	const loaded = await resolveStandardsPacks({ cwd, config });
	const channels = config['standards-channels'] ?? (await detectStandardsChannels({ cwd, packagesDir: config['packages-dir'] ?? 'packages', packages }));
	const assembled = loaded.map((pack) => buildStandardsDocuments({ pack, channels }));

	const stack = ({ set }: { set: StandardsSet }) => {
		const texts = assembled.map((documents) => documents[set]).filter((text) => text !== undefined);

		return texts.length === 0 ? undefined : texts.join('\n\n');
	};

	return {
		standards: stack({ set: StandardsSet.Code }),
		testStandards: stack({ set: StandardsSet.Tests }),
		channels,
		configured: config['standards-channels'] !== undefined,
		requested: loaded.length > 0,
	};
};
