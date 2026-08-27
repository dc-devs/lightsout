import {
	getPlanDocument,
	getRunView,
	getStandardsPackRuleView,
	getStandardsPackView,
	getStandardsView,
	listRuns,
	listStandardsPacks,
	type StandardsPackListing,
	toStandardsPackListing,
	toStandardsPackRuleView,
	toStandardsPackView,
} from '@lightsout/engine';
import type { LightsoutReader } from '#src/lightsout/common/types/LightsoutReader.ts';
import { getDefaultPackBundle } from '#src/lightsout/common/utils/getDefaultPackBundle.ts';

/** The shipped default pack, which the bundler stripped the fixtures out of — the one entry the carried view stands in for. */
const isStrippedDefault = ({ listing }: { listing: StandardsPackListing }) => {
	return listing.isDefault && listing.built;
};

interface ConstructorParams {
	/** Absolute path of the repo whose `.lightsout/` is read. */
	repoRoot: string;
}

/**
 * The v1 reader: every method is a direct call into the engine with this
 * process's repo root as its `cwd`.
 *
 * A class because both of the standards' bright lines hold at once — every
 * operation shares one injected dependency, and a second implementation of the
 * same interface behind an HTTP call is the whole reason the interface exists.
 *
 * Nothing is reshaped, cached or caught here, with one stated exception: the
 * pack a run loads when a config names none is, on any repo that is not this
 * monorepo, the copy `plugin/standards/` ships — and that copy has its fixtures
 * stripped, so a rule page would have nothing to show. The three pack methods
 * serve `assets/default-pack.json`, the authored view this app carries, in its
 * place. Packs a config names are read live from their own folders and never
 * substituted.
 *
 * A `RunNotFoundError` from the engine travels to the server function, which is
 * where it becomes a 404.
 */
export class InProcessReader implements LightsoutReader {
	private readonly repoRoot: string;

	constructor({ repoRoot }: ConstructorParams) {
		this.repoRoot = repoRoot;
	}

	listRuns() {
		return listRuns({ cwd: this.repoRoot });
	}

	getRun({ runId }: { runId: string }) {
		return getRunView({ cwd: this.repoRoot, runId });
	}

	getStandards() {
		return getStandardsView({ cwd: this.repoRoot });
	}

	getPlan({ path }: { path: string }) {
		return getPlanDocument({ cwd: this.repoRoot, path });
	}

	async listPacks() {
		const listings = await listStandardsPacks({ cwd: this.repoRoot });

		return listings.map((listing) => (isStrippedDefault({ listing }) ? toStandardsPackListing({ bundle: getDefaultPackBundle() }) : listing));
	}

	async getPack({ name }: { name: string }) {
		return (await this.isSubstituted({ name })) ? toStandardsPackView({ bundle: getDefaultPackBundle() }) : getStandardsPackView({ cwd: this.repoRoot, name });
	}

	async getPackRule({ name, rule }: { name: string; rule: string }) {
		return (await this.isSubstituted({ name }))
			? toStandardsPackRuleView({ bundle: getDefaultPackBundle(), rule })
			: getStandardsPackRuleView({ cwd: this.repoRoot, name, rule });
	}

	/**
	 * Whether this name addresses that stripped copy on THIS repo.
	 *
	 * The listing is consulted rather than the name alone. On this monorepo the
	 * default pack resolves to the authored folder, which has its fixtures and may
	 * have been edited since `pnpm build:default-pack` last ran — matching on the
	 * name would serve the snapshot and let the page drift from the pack beside
	 * it. The listing read costs nothing the bundle cache is not already holding.
	 */
	private async isSubstituted({ name }: { name: string }) {
		const listings = await listStandardsPacks({ cwd: this.repoRoot });

		return listings.some((listing) => listing.name === name && isStrippedDefault({ listing }));
	}
}
