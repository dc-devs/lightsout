import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import { gapCheckLenses } from '#src/plan/internal/common/constants/gapCheckLenses.ts';
import { getCoverageSeeds } from '#src/plan/internal/common/scope/getCoverageSeeds.ts';
import { getDesignHashes } from '#src/plan/internal/common/scope/getDesignHashes.ts';
import { getEditedPhases } from '#src/plan/internal/common/scope/getEditedPhases.ts';
import { getStandingCoverage } from '#src/plan/internal/common/scope/getStandingCoverage.ts';

interface Params {
	/** Every implementable plan-file basename the deliverable holds now. */
	phaseFiles: string[];
	/** Overview text for a phased plan; absent for a single plan. */
	overviewText?: string;
	/** This pass's fingerprint — the design hashes a recorded reading is compared against. */
	inputs: GradeInputs;
	/** The coverage record the answer is measured from. */
	coverage: GradeMemory['coverage'];
	/** The phase graph as it stands now; absent when it could not be built, which loses every plan file. */
	connections?: Map<string, Set<string>>;
	/** The fingerprint the record was taken against; see the BEFORE/AFTER note below. */
	baseline?: GradeInputs;
}

/**
 * What one coverage record covers of the plan in front of this pass.
 *
 * `baseline` is the fingerprint the record was taken against, and giving it is
 * what makes this the BEFORE reading: the plan files a changed decision row or a
 * moved input places as lost fall with it, through the same shared derivation
 * `decideGradeScope` narrows by rather than a copy of it, and a reach that cannot
 * be placed falls back to every plan file. Omitting it asks the AFTER question —
 * what the record this pass has just written covers — where both are statements
 * about a reading taken EARLIER, which this pass has since redone.
 */
export const getPassCoverage = ({ phaseFiles, overviewText, inputs, coverage, connections, baseline }: Params): ReturnType<typeof getStandingCoverage> => {
	const seeded = baseline === undefined ? { seeds: [] } : getCoverageSeeds({ inputs, previous: baseline, overviewText, phaseFiles });

	return getStandingCoverage({
		coverage,
		designHashes: getDesignHashes({ inputs }),
		phaseFiles,
		lenses: gapCheckLenses,
		connections,
		otherInputChanged: baseline !== undefined && getEditedPhases({ current: inputs, previous: baseline }).otherInputChanged,
		seeds: 'error' in seeded ? phaseFiles : seeded.seeds,
	});
};
