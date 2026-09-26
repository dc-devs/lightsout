import { ConfigNotFoundError, commandCatalog, PlanDocumentKind, PlanWorkspaceNotFoundError, RunNotFoundError } from '@lightsout/engine';
import type { LightsoutReader } from '#src/lightsout/common/types/LightsoutReader.ts';
import { getDemoRunListings } from '#src/lightsout/common/utils/getDemoRunListings.ts';
import { getDemoRunViews } from '#src/lightsout/common/utils/getDemoRunViews.ts';

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

	/** The one method that is not a fixture at all: the catalog ships with the engine, so a build holding no repo answers it in full. */
	async listCommands() {
		return commandCatalog;
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
	 * `/app/standards` stays registered and reachable on a public build, and its
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

	/** An empty log is an honest answer: this build has no repo, so nothing ever reported friction in it. */
	async getFriction() {
		return [];
	}

	/**
	 * The one absence that is not an empty form.
	 *
	 * A config page is about a file, and on a build holding no repo that file does
	 * not exist — which is a 404 rather than a page of blank rows. The server
	 * function turns this typed error into exactly that.
	 *
	 * @throws {ConfigNotFoundError} Always — this build reads no repo.
	 */
	async getConfig(): Promise<never> {
		throw new ConfigNotFoundError({ configPath: 'lightsout.config.json' });
	}

	/** An empty list is the honest answer: a public site holds no repo, so nobody has planned anything in it. */
	async listPlanWorkspaces() {
		return [];
	}

	/**
	 * The second absence that is not an empty form, for the reason `getConfig`
	 * states: a plan page is about one workspace, and this build has none.
	 *
	 * @throws {PlanWorkspaceNotFoundError} Always — this build reads no repo.
	 */
	async getPlanWorkspace({ name }: { name: string }): Promise<never> {
		throw new PlanWorkspaceNotFoundError({ name });
	}
}
