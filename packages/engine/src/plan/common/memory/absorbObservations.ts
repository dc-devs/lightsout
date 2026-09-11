import { type GapObservation, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';
import { recordObservations } from '#src/plan/common/memory/recordObservations.ts';
import { recordResolutions } from '#src/plan/common/memory/recordResolutions.ts';
import { reopenRecord } from '#src/plan/common/memory/reopenRecord.ts';
import { dedupeObservations } from '#src/plan/common/observations/dedupeObservations.ts';
import { findingLocations } from '#src/plan/common/utils/findingLocations.ts';

interface Params {
	record: GradeFindingRecord;
	/** The observations joining the record. */
	observations: GapObservation[];
	/** The pass timestamp, written into a `reopened` entry when the join reopens the record. */
	at: string;
}

/**
 * A record holding every observation it held plus the ones joining it,
 * de-duplicated — and reopened when it was resolved and thereby gains a plan
 * file its resolutions hold no confirmed citation for.
 *
 * A closure is a claim about specific locations; a new location is a claim
 * nobody has verified, and inheriting the closure would turn an unproven repair
 * into an approval. What the record held is read through `recordObservations`,
 * so a record written before grouping existed keeps its own location rather
 * than losing it to the first observation that joins.
 */
export const absorbObservations = ({ record, observations, at }: Params): GradeFindingRecord => {
	const merged = { ...record, observations: dedupeObservations({ observations: [...recordObservations({ record }), ...observations] }) };
	const cited = new Set(recordResolutions({ record }).map(({ phase }) => phase));
	const uncovered = findingLocations({ observations: merged.observations, phase: record.phase }).filter((location) => !cited.has(location));
	const reason = `gained an observation at ${uncovered.join(', ')}, where no confirmed citation closes it`;

	return record.status === GradeFindingStatus.Resolved && uncovered.length > 0 ? reopenRecord({ record: merged, reason, at }) : merged;
};
