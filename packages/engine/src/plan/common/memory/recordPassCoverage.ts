import type { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import type { GradeDocsCoverage } from '#src/contracts/plan/memory/GradeDocsCoverage.ts';
import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import type { GradeReadCoverage } from '#src/contracts/plan/memory/GradeReadCoverage.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { recordReadCoverage } from '#src/plan/common/memory/recordReadCoverage.ts';
import { getDesignHashes } from '#src/plan/common/scope/getDesignHashes.ts';
import { getPassCoverage } from '#src/plan/common/scope/getPassCoverage.ts';

interface Params {
	/** Every implementable plan-file basename the deliverable holds now. */
	planFiles: string[];
	/** Overview text for a phased plan; absent for a single plan. */
	overviewText?: string;
	/** This pass's fingerprint — where each plan file's current design hash is read from. */
	inputs: GradeInputs;
	/** The reader entries that still stood when this pass began. */
	standing: GradeReadCoverage[];
	/** The documentation entry that still stood when this pass began; absent when it fell or was never written. */
	docs?: GradeDocsCoverage;
	/** Every (plan file, lens) pair a reader RETURNED for on this pass. */
	read: Array<{ phase: string; lens: GapCheckLens }>;
	/** The plan files `weighSelection` weighed light — read by nobody, and covered at their current text. */
	light: string[];
	/** The phase graph as it stands now; absent when it could not be built. */
	connections?: Map<string, Set<string>>;
	/** Whether the whole-plan documentation checker ran AND returned on this pass. */
	documentationChecked: boolean;
	/** True when a human narrowed this pass with `--phase`: nothing is recorded. */
	narrowed: boolean;
	/** The pass timestamp every entry written here carries. */
	at: string;
}

/**
 * What this pass leaves the plan covered at: its own readings folded into the
 * record, and then what that record stands for.
 *
 * The order is the whole point of the function. The entries are written BEFORE
 * the coverage is read back, because the verdict speaks for the plan as a whole
 * and so has to see what this pass itself just read. Reading back with no
 * baseline asks the AFTER question deliberately: the seeds a baseline supplies
 * are statements about a reading taken earlier, which this pass has since redone.
 *
 * @returns the next coverage value to persist, and what it covers now
 */
export const recordPassCoverage = ({
	planFiles,
	overviewText,
	inputs,
	standing,
	docs,
	read,
	light,
	connections,
	documentationChecked,
	narrowed,
	at,
}: Params): { coverage: GradeMemory['coverage']; standing: ReturnType<typeof getPassCoverage> } => {
	const coverage = recordReadCoverage({
		standing,
		docs,
		read,
		light: { phases: light, lenses: gapCheckLenses },
		designHashes: getDesignHashes({ inputs }),
		connections,
		documentationChecked,
		narrowed,
		at,
	});

	return { coverage, standing: getPassCoverage({ phaseFiles: planFiles, overviewText, inputs, coverage, connections }) };
};
