import type { ExportCensus } from '#src/plan/evidence/common/types/ExportCensus.ts';
import type { ExportCollision } from '#src/plan/evidence/common/types/ExportCollision.ts';
import { collapseCasing } from '#src/plan/internal/common/naming/collapseCasing.ts';
import { getNameKey } from '#src/plan/internal/common/naming/getNameKey.ts';

interface Params {
	census: ExportCensus;
	/** The names a phase declaration says this writer will export. */
	symbols: string[];
}

/**
 * Which of a writer's planned symbols an existing export already answers to.
 *
 * The comparator is `detectPriorArtCandidates`' exactly: the same `getNameKey`
 * bucket lookup, the same `collapseCasing` exemption for a name that differs
 * from an existing one only by casing or separators (`GetStarted` beside
 * `get-started` is a framework pair, not a duplicate), and the same skip for the
 * name `index`. What differs is the input — symbols a phase declaration names,
 * rather than symbols parsed out of a written plan file. Pure and synchronous,
 * because the census is handed in.
 *
 * This is not the whole prior-art answer. Naming-based detection cannot prove
 * that differently named functionality is absent, so the engine supplies what it
 * can compute and the writer states the reuse decision the result implies;
 * investigating a real collision stays agent work.
 */
export const detectExportCollisions = ({ census, symbols }: Params): ExportCollision[] => {
	const collisions: ExportCollision[] = [];

	for (const symbol of symbols) {
		if (symbol === 'index') {
			continue;
		}

		const bucket = census.get(getNameKey({ name: symbol })) ?? [];
		const collidesWith = bucket.filter((entry) => entry.name === symbol || collapseCasing({ name: entry.name }) !== collapseCasing({ name: symbol }));

		if (collidesWith.length > 0) {
			collisions.push({ symbol, collidesWith });
		}
	}

	return collisions;
};
