import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	/** The consumer's config, or nothing when a caller could not read one. */
	config?: Pick<LightsoutConfig, 'generated' | 'vendored'>;
}

/**
 * Every path prefix the source walk must skip: generated output plus vendored
 * third-party code.
 *
 * One function rather than a spread at each call site. Five callers ask "what
 * is not this repo's source?" — the pipeline's universe, the test writer's
 * subject pool, the prior-art scan, the standards check, and the standalone
 * review — and a sixth answer appearing in only four of them is exactly the
 * bug this prevents: a folder judged by the checks that the test writer had
 * already been told to ignore.
 *
 * Attribution deliberately does NOT use this. `collectChanged` asks a
 * narrower question — which changed files earn an agent turn — and the two
 * lists answer it differently: generated output is the by-product of a change
 * made elsewhere, while a vendored file has no such source in the repo, so
 * editing one IS the change.
 */
export const excludedSourcePaths = ({ config }: Params): string[] => [...(config?.generated ?? []), ...(config?.vendored ?? [])];
