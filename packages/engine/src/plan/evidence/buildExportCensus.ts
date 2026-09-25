import { excludedSourcePaths } from '#src/common/sourceFiles/excludedSourcePaths.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { getExportName } from '#src/plan/common/naming/getExportName.ts';
import { getNameKey } from '#src/plan/common/naming/getNameKey.ts';
import type { ExportCensus } from '#src/plan/evidence/common/types/ExportCensus.ts';

interface Params {
	cwd: string;
	config?: LightsoutConfig;
	/** Repo-relative paths that contribute no entry — a plan's own created and emptied paths. */
	exclude?: string[];
}

/**
 * The repository's existing exports, bucketed by the tier-0 name comparator.
 *
 * One-export-per-file makes a source file's basename its symbol, so the census
 * is every non-test, non-`index` source file outside the consumer's generated
 * and vendored paths. Test files and barrels are left out because neither can be
 * prior art: a test states what the code should do, and a barrel re-exports a
 * name declared somewhere the census already holds.
 *
 * Hoisted out of `detectPriorArtCandidates`, which built it inline, so a phase
 * writer's declared symbols can be checked against the same census a written
 * plan's are — one copy rather than two, and one expensive repository-wide read
 * per run rather than one per consumer.
 */
export const buildExportCensus = async ({ cwd, config, exclude = [] }: Params): Promise<ExportCensus> => {
	const excluded = new Set(exclude);
	const { files, standardsPacks } = await listSourceFiles({ cwd, exclude: excludedSourcePaths({ config }) });
	const buckets: ExportCensus = new Map();

	for (const file of files) {
		const name = getExportName({ path: file });

		if (isTestFile({ path: file, standardsPacks }) || name === 'index' || excluded.has(file)) {
			continue;
		}

		const key = getNameKey({ name });

		buckets.set(key, [...(buckets.get(key) ?? []), { name, path: file }]);
	}

	return buckets;
};
