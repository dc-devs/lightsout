import { getPlanDocument, getRunView, getStandardsView, listRuns } from '@lightsout/engine';
import type { LightsoutReader } from '#src/lightsout/common/types/LightsoutReader.ts';

interface ConstructorParams {
	/** Absolute path of the repo whose `.lightsout/` is read. */
	repoRoot: string;
}

/**
 * The v1 reader: every method is a direct call into the engine with this
 * process's repo root as its `cwd`.
 *
 * A class because both of the standards' bright lines hold at once — four
 * operations share one injected dependency, and a second implementation of the
 * same interface behind an HTTP call is the whole reason the interface exists.
 *
 * Nothing is reshaped, cached or caught here. A `RunNotFoundError` from the
 * engine travels to the server function, which is where it becomes a 404.
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
}
