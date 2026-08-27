import { StandardsPackBundle } from '@lightsout/engine';
import bundle from '#assets/default-pack.json';

/** Parsed once, for the same reason `getDemoRunViews` is: the file is bundled data that cannot change while the app runs. */
let parsed: StandardsPackBundle | undefined;

/**
 * The authored default pack, whole, as `scripts/buildDefaultPackView.mjs`
 * committed it to `assets/default-pack.json`.
 *
 * The app carries it because the pack a run loads by default is the copy
 * `plugin/standards/` ships, which the bundler strips the fixtures out of — and
 * a rule page exists to show the code a rule argues about. This view is what
 * `FixtureReader` serves outright and what `InProcessReader` substitutes
 * wherever the engine finds that stripped copy.
 */
export const getDefaultPackBundle = (): StandardsPackBundle => {
	if (parsed === undefined) {
		parsed = StandardsPackBundle.parse(bundle);
	}

	return parsed;
};
