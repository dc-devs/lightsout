import { readFile } from 'node:fs/promises';
import type { LightsoutConfig } from '@/contracts';
import { isTestFile } from '@/common/utils/isTestFile';
import { listSourceFiles } from '@/common/utils/listSourceFiles';
import { collapseCasing } from '@/common/naming/collapseCasing';
import { nameKey } from '@/common/naming/nameKey';
import { nameOf } from '@/common/naming/nameOf';
import type { PriorArtCandidate } from '@/plan/common/types/PriorArtCandidate';
import { planCreatePaths } from '@/plan/planCreatePaths';

interface Params {
	cwd: string;
	/** Absolute paths to the plan file(s) whose Files-to-Create symbols are checked. */
	planPaths: string[];
	config?: LightsoutConfig;
}

/**
 * Deterministic plan-time prior-art detection — no agent. Reuses the standards
 * check's tier-0 comparator (`nameKey`) to check every planned new symbol (each
 * Files-to-Create basename, `index` excluded) against the repo's existing
 * export census (non-test, non-`index` source files, minus the not-yet-created
 * planned paths).
 * A planned symbol whose name-key bucket holds a real match — same name, or a
 * synonym/word-order twin, but excluding a pure component+route casing pair — is
 * a candidate. Pure and unit-testable; the doctrine's "grep, not the agent's
 * claim" is what makes enforcement real.
 */
export const detectPriorArtCandidates = async ({ cwd, planPaths, config }: Params): Promise<PriorArtCandidate[]> => {
	// 1. Planned new symbols from every plan's Files to Create.
	const planned: Array<{ plannedSymbol: string; plannedPath: string }> = [];
	const plannedPaths = new Set<string>();

	for (const planPath of planPaths) {
		const planText = await readFile(planPath, 'utf8').catch(() => undefined);

		if (planText === undefined) {
			continue;
		}

		for (const createPath of planCreatePaths({ planText })) {
			plannedPaths.add(createPath);

			const plannedSymbol = nameOf(createPath);

			if (plannedSymbol === 'index') {
				continue;
			}

			planned.push({ plannedSymbol, plannedPath: createPath });
		}
	}

	if (planned.length === 0) {
		return [];
	}

	// 2. Existing export census — non-test, non-index, and not a planned (not-yet-created) path.
	const { files, standardsPackages } = await listSourceFiles({ cwd, exclude: config?.generated });
	const census = files
		.filter((file) => !isTestFile({ path: file, standardsPackages }) && nameOf(file) !== 'index' && !plannedPaths.has(file))
		.map((file) => ({ name: nameOf(file), path: file }));

	// 3. Bucket the census by name-key.
	const buckets = new Map<string, Array<{ name: string; path: string }>>();

	for (const entry of census) {
		const key = nameKey({ name: entry.name });

		buckets.set(key, [...(buckets.get(key) ?? []), entry]);
	}

	// 4. Each planned symbol whose bucket holds a real (non-casing-pair) match is a candidate.
	const candidates: PriorArtCandidate[] = [];

	for (const { plannedSymbol, plannedPath } of planned) {
		const bucket = buckets.get(nameKey({ name: plannedSymbol })) ?? [];

		// A different name that collapses to the same casing key (`GetStarted` vs
		// `get-started`) is a framework pair, not a duplicate — exempt it. An
		// exact-name match is a real duplicate and stays.
		const collidesWith = bucket.filter(
			(entry) => entry.name === plannedSymbol || collapseCasing(entry.name) !== collapseCasing(plannedSymbol),
		);

		if (collidesWith.length > 0) {
			candidates.push({ plannedSymbol, plannedPath, collidesWith });
		}
	}

	return candidates;
};
