import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { getExportName } from '#src/plan/common/utils/getExportName.ts';
import { buildExportCensus } from '#src/plan/evidence/buildExportCensus.ts';
import { detectExportCollisions } from '#src/plan/evidence/detectExportCollisions.ts';
import type { PriorArtCandidate } from '#src/plan/internal/common/types/PriorArtCandidate.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	cwd: string;
	/** Absolute paths to the plan file(s) whose Files-to-Create symbols are checked. */
	planPaths: string[];
	config?: LightsoutConfig;
}

/**
 * Deterministic plan-time prior-art detection — no agent. Reuses the standards
 * check's tier-0 comparator (`getNameKey`) to check every planned new symbol (each
 * Files-to-Create basename, `index` excluded) against the repo's existing
 * export census.
 *
 * The census is the repo the plan leaves behind, not the repo as it stands
 * today: non-test, non-`index` source files, minus the paths the plan creates,
 * minus the paths it empties — a file under `## Files to Delete`, or the
 * source side of a `## Files to Move` pair. Without that subtraction a plan
 * that moves a symbol between packages collides with itself, and no
 * resolution can ever clear the collision because the file it names is still
 * on disk. The plan is read through `parsePlan`, the same parser the
 * structural lint uses, so the two can never disagree about which section
 * says what.
 *
 * A move's destination is deliberately not added back. The comparison is
 * planned-new against existing-on-disk throughout, and a moved file's new home
 * is planned like any other.
 *
 * A planned symbol whose name-key bucket holds a real match — same name, or a
 * synonym/word-order twin, but excluding a pure component+route casing pair — is
 * a candidate, tagged with the plan file that declared it so the dedup fan-out
 * can group by phase. Pure and unit-testable; the doctrine's "grep, not the agent's
 * claim" is what makes enforcement real.
 *
 * The census and the bucket comparison themselves live in `buildExportCensus`
 * and `detectExportCollisions`, so a focused plan writer's declared symbols are
 * checked against the same census a written plan's are. The subtraction above is
 * this function's own decision and is passed in as the census's `exclude` list —
 * which is why the reasoning for it stays here.
 */
export const detectPriorArtCandidates = async ({ cwd, planPaths, config }: Params): Promise<PriorArtCandidate[]> => {
	const planned: Array<{ plannedSymbol: string; plannedPath: string; phase: string }> = [];
	const plannedPaths = new Set<string>();
	const emptiedPaths = new Set<string>();

	for (const planPath of planPaths) {
		const planText = await readFile(planPath, 'utf8').catch(() => undefined);

		if (planText === undefined) {
			continue;
		}

		const base = basename(planPath);
		const plan = parsePlan({ content: planText, base });

		// Union across every plan file: a phase deleting a file empties it for the
		// whole plan, whichever phase planned the symbol that collided with it.
		for (const path of [...plan.deletePaths, ...plan.movePaths.map((move) => move.from)]) {
			emptiedPaths.add(path);
		}

		for (const createPath of plan.createPaths) {
			plannedPaths.add(createPath);

			const plannedSymbol = getExportName({ path: createPath });

			if (plannedSymbol === 'index') {
				continue;
			}

			planned.push({ plannedSymbol, plannedPath: createPath, phase: base });
		}
	}

	if (planned.length === 0) {
		return [];
	}

	const census = await buildExportCensus({ cwd, config, exclude: [...plannedPaths, ...emptiedPaths] });
	// One lookup per distinct symbol name, keyed by that name: two phases can plan
	// the same basename, and both have to be reported.
	const collisions = new Map(
		detectExportCollisions({ census, symbols: planned.map(({ plannedSymbol }) => plannedSymbol) }).map((collision) => [
			collision.symbol,
			collision.collidesWith,
		]),
	);
	const candidates: PriorArtCandidate[] = [];

	for (const { plannedSymbol, plannedPath, phase } of planned) {
		const collidesWith = collisions.get(plannedSymbol);

		if (collidesWith !== undefined) {
			candidates.push({ plannedSymbol, plannedPath, phase, collidesWith });
		}
	}

	return candidates;
};
