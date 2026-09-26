import { StandardsPackBundle } from '@lightsout/engine';
import bundle from '#assets/default-pack.json';

/** Parsed once: the file is bundled data that cannot change while the app runs. */
let parsed: StandardsPackBundle | undefined;

/**
 * The authored default pack, whole, as `scripts/buildDefaultPackView.mjs`
 * committed it to `assets/default-pack.json`.
 *
 * The app carries it because the public Standards Packs pages document what
 * every repo gets out of the box: the same pack, whole, wherever the site runs.
 * It is the authored pack rather than the copy `plugin/standards/` ships, which
 * the bundler strips the fixtures out of — and a rule page exists to show the
 * code a rule argues about.
 */
export const getDefaultPackBundle = (): StandardsPackBundle => {
	if (parsed === undefined) {
		parsed = StandardsPackBundle.parse(bundle);
	}

	return parsed;
};
