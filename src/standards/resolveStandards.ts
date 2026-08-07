import type { LightsoutConfig } from '@/contracts';
import { detectStandardsChannels } from '@/standards/detectStandardsChannels';
import { readStandards } from '@/standards/readStandards';

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
	/** Some standards were asked for — false when the consumer disabled both sets. */
	requested: boolean;
}

/**
 * Resolve both standards sets for a run: which docs the config asks for, which
 * framework channels apply, and the loaded text of each.
 *
 * The config's three-way meaning is encoded once, here: unspecified = the
 * bundled defaults (announced, never silent), `false` = explicitly none, an
 * array = exactly what it says. Both pipelines resolve standards the same way,
 * and a rule this easy to state slightly differently in two places is a rule
 * that eventually drifts.
 *
 * Reading is left to throw — a consumer that declared standards and did not get
 * them must not run, and each pipeline reports that failure in its own terms.
 */
export const resolveStandards = async ({ cwd, config, packages }: Params): Promise<ResolvedStandards> => {
	const standardsPaths = config.standards === false ? [] : (config.standards ?? ['lightsout:code-defaults']);
	const testStandardsPaths = config.testStandards === false ? [] : (config.testStandards ?? ['lightsout:test-defaults']);
	const channels =
		config.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir: config.packagesDir ?? 'packages', packages }));

	return {
		standards: await readStandards({ cwd, paths: standardsPaths, channels }),
		testStandards: await readStandards({ cwd, paths: testStandardsPaths, channels }),
		channels,
		configured: config.standardsChannels !== undefined,
		requested: standardsPaths.length > 0 || testStandardsPaths.length > 0,
	};
};
