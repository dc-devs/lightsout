import { StandardsSet, type LightsoutConfig } from '@/contracts';
import { detectStandardsChannels } from '@/standards/detectStandardsChannels';
import { buildStandardsDocuments, resolveStandardsPackages } from '@/standardsPackages';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Scoped packages whose dependencies decide the framework channels. Empty = base docs only. */
	packages: string[];
}

interface ResolvedStandards {
	standards?: string;
	testStandards?: string;
	/** Framework channels in play, for the caller's progress line. */
	channels: string[];
	/** Channels came from config rather than dependency detection. */
	configured: boolean;
	/** Some standards were asked for — false when the consumer loaded no packages. */
	requested: boolean;
}

/**
 * Resolve both standards sets for a run: which packages the config asks for,
 * which framework channels apply, and the assembled text of each set.
 *
 * Assembly happens here, from the rule folders themselves, so no pre-built copy
 * exists anywhere to drift from the prose it was built from. Several packages
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
 * @throws {Error} When a declared standards package cannot be loaded.
 */
export const resolveStandards = async ({ cwd, config, packages }: Params): Promise<ResolvedStandards> => {
	const loaded = await resolveStandardsPackages({ cwd, config });
	const channels =
		config.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir: config.packagesDir ?? 'packages', packages }));
	const assembled = loaded.map((pkg) => buildStandardsDocuments({ pkg, channels }));

	const stack = ({ set }: { set: StandardsSet }) => {
		const texts = assembled.map((documents) => documents[set]).filter((text) => text !== undefined);

		return texts.length === 0 ? undefined : texts.join('\n\n');
	};

	return {
		standards: stack({ set: StandardsSet.Code }),
		testStandards: stack({ set: StandardsSet.Tests }),
		channels,
		configured: config.standardsChannels !== undefined,
		requested: loaded.length > 0,
	};
};
