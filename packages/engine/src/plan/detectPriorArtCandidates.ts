import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { excludedSourcePaths } from '#src/common/sourceFiles/excludedSourcePaths.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { collapseCasing } from '#src/plan/common/naming/collapseCasing.ts';
import { getExportName } from '#src/plan/common/naming/getExportName.ts';
import { getNameKey } from '#src/plan/common/naming/getNameKey.ts';
import type { PriorArtCandidate } from '#src/plan/common/types/PriorArtCandidate.ts';
import { planCreatePaths } from '#src/plan/planCreatePaths.ts';

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
 * export census (non-test, non-`index` source files, minus the not-yet-created
 * planned paths).
 * A planned symbol whose name-key bucket holds a real match — same name, or a
 * synonym/word-order twin, but excluding a pure component+route casing pair — is
 * a candidate, tagged with the plan file that declared it so the dedup fan-out
 * can group by phase. Pure and unit-testable; the doctrine's "grep, not the agent's
 * claim" is what makes enforcement real.
 */
export const detectPriorArtCandidates = async ({ cwd, planPaths, config }: Params): Promise<PriorArtCandidate[]> => {
	const planned: Array<{ plannedSymbol: string; plannedPath: string; phase: string }> = [];
	const plannedPaths = new Set<string>();

	for (const planPath of planPaths) {
		const planText = await readFile(planPath, 'utf8').catch(() => undefined);

		if (planText === undefined) {
			continue;
		}

		for (const createPath of planCreatePaths({ planText })) {
			plannedPaths.add(createPath);

			const plannedSymbol = getExportName({ path: createPath });

			if (plannedSymbol === 'index') {
				continue;
			}

			planned.push({ plannedSymbol, plannedPath: createPath, phase: basename(planPath) });
		}
	}

	if (planned.length === 0) {
		return [];
	}

	const { files, standardsPacks } = await listSourceFiles({ cwd, exclude: excludedSourcePaths({ config }) });
	const census = files
		.filter((file) => !isTestFile({ path: file, standardsPacks }) && getExportName({ path: file }) !== 'index' && !plannedPaths.has(file))
		.map((file) => ({ name: getExportName({ path: file }), path: file }));

	const buckets = new Map<string, Array<{ name: string; path: string }>>();

	for (const entry of census) {
		const key = getNameKey({ name: entry.name });

		buckets.set(key, [...(buckets.get(key) ?? []), entry]);
	}

	const candidates: PriorArtCandidate[] = [];

	for (const { plannedSymbol, plannedPath, phase } of planned) {
		const bucket = buckets.get(getNameKey({ name: plannedSymbol })) ?? [];

		// A different name that collapses to the same casing key (`GetStarted` vs
		// `get-started`) is a framework pair, not a duplicate — exempt it. An
		// exact-name match is a real duplicate and stays.
		const collidesWith = bucket.filter(
			(entry) => entry.name === plannedSymbol || collapseCasing({ name: entry.name }) !== collapseCasing({ name: plannedSymbol }),
		);

		if (collidesWith.length > 0) {
			candidates.push({ plannedSymbol, plannedPath, phase, collidesWith });
		}
	}

	return candidates;
};
