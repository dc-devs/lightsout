import { RunView } from '@lightsout/engine/contracts';
import implement from '#assets/demo-runs/implement.json';
import refactor from '#assets/demo-runs/refactor.json';
import stopped from '#assets/demo-runs/stopped.json';
import { DemoRunSlug } from '#src/lightsout/common/constants/DemoRunSlug.ts';

/** Parsed once. The JSON is a build artefact bundled into the app; it cannot change while the app runs. */
let parsed: Record<DemoRunSlug, RunView> | undefined;

/**
 * The three runs `scripts/freezeDemoRuns.mjs` froze out of this repo's own run
 * history, keyed by what each one demonstrates.
 *
 * Parsed at the boundary like every other reader in this app: the files are
 * bundled data rather than something typechecked into existence, so they are
 * validated on the way in. That parse is what catches a fixture gone stale after
 * a contract change, at test time rather than in a reader's browser.
 */
export const getDemoRunViews = (): Record<DemoRunSlug, RunView> => {
	if (parsed === undefined) {
		parsed = {
			[DemoRunSlug.Implement]: RunView.parse(implement),
			[DemoRunSlug.Refactor]: RunView.parse(refactor),
			[DemoRunSlug.Stopped]: RunView.parse(stopped),
		};
	}

	return parsed;
};
