import {
	PlanDocumentKind,
	RunNotFoundError,
	StandardsPackNotFoundError,
	toStandardsPackListing,
	toStandardsPackRuleView,
	toStandardsPackView,
} from '@lightsout/engine';
import type { LightsoutReader } from '#src/lightsout/common/types/LightsoutReader.ts';
import { getDefaultPackBundle } from '#src/lightsout/common/utils/getDefaultPackBundle.ts';
import { getDemoRunListings } from '#src/lightsout/common/utils/getDemoRunListings.ts';
import { getDemoRunViews } from '#src/lightsout/common/utils/getDemoRunViews.ts';

/**
 * The one pack this reader carries, under the name it answers to.
 *
 * @throws {StandardsPackNotFoundError} When the name addresses any other pack — this build holds no others.
 */
const readBundle = ({ name }: { name: string }) => {
	const bundle = getDefaultPackBundle();

	if (name !== bundle.name) {
		throw new StandardsPackNotFoundError({ name });
	}

	return bundle;
};

/**
 * The reader a build with no repo under it holds: every method answered from
 * committed JSON, so the sell zone renders with nothing on disk.
 *
 * A class for the same two reasons `InProcessReader` is one — several operations
 * behind one interface, and a second implementation of that interface is why the
 * interface exists.
 *
 * The rule every method follows: answer with the contract's empty form, and
 * throw only the typed not-found errors the server functions already turn into
 * `notFound()`. A deep link into the local zone on a public build then renders
 * that page's own empty state rather than a 500.
 *
 * The pack answers come out of the engine's own projections, so the public site
 * and a local viewer render the same shapes from the same code.
 */
export class FixtureReader implements LightsoutReader {
	async listRuns() {
		return getDemoRunListings();
	}

	/** By full id or by the shortened form a report printed, matching `getRunView`'s own contract. */
	async getRun({ runId }: { runId: string }) {
		const view = Object.values(getDemoRunViews()).find((entry) => entry.listing.runId === runId || entry.listing.shortId === runId);

		if (view === undefined) {
			throw new RunNotFoundError(`no run matching '${runId}' — this build serves the three runs the site shows as proof`);
		}

		return view;
	}

	/**
	 * The empty standards view, said out loud.
	 *
	 * `/repo/standards` stays registered and reachable on a public build, and its
	 * loader suspends on this query, so a throw here would be a 500 on a deep
	 * link. The page's own "no check has run" state is the right answer instead.
	 */
	async getStandards() {
		return {
			path: '.',
			notes: ['No repository was found — this is the public build, which serves no standards check.'],
			findings: [],
			rules: [],
			trend: [],
			totals: { rules: 0, checked: 0, judgment: 0, blocking: 0, advisory: 0, orphans: 0 },
		};
	}

	/** A recorded absence, matching `getPlanDocument`'s own habit, so a plan drawer degrades rather than crashes. */
	async getPlan({ path }: { path: string }) {
		return { path, kind: PlanDocumentKind.Missing };
	}

	async listPacks() {
		return [toStandardsPackListing({ bundle: getDefaultPackBundle() })];
	}

	async getPack({ name }: { name: string }) {
		return toStandardsPackView({ bundle: readBundle({ name }) });
	}

	async getPackRule({ name, rule }: { name: string; rule: string }) {
		// `toStandardsPackRuleView` throws `StandardsPackRuleNotFoundError` for an
		// id the pack does not carry, which the server function turns into the same
		// not-found the pack name does.
		return toStandardsPackRuleView({ bundle: readBundle({ name }), rule });
	}
}
