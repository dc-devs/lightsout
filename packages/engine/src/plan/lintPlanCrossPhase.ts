import { checkFileProvenance } from '#src/plan/checkFileProvenance.ts';
import { checkPhaseCount } from '#src/plan/checkPhaseCount.ts';
import { checkPhaseDeclarations } from '#src/plan/checkPhaseDeclarations.ts';
import { checkPhaseHandoffs } from '#src/plan/checkPhaseHandoffs.ts';
import type { CrossPhaseLintResult } from '#src/plan/common/types/CrossPhaseLintResult.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseProvenance } from '#src/plan/common/types/PhaseProvenance.ts';
import type { PhaseSizeCounts } from '#src/plan/common/types/PhaseSizeCounts.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';

interface Params {
	cwd: string;
	/** The parsed overview, when the deliverable is phased. */
	overview?: PhaseFile;
	/** Implementable plan files, ordered by phase number. */
	phases: PhaseFile[];
	provenance: PhaseProvenance;
	/** Source-file counts per phase basename, computed once by the caller. */
	counts: Map<string, PhaseSizeCounts>;
}

/**
 * The checks that need more than one plan file in view: file provenance,
 * hand-off names, overview-versus-phase declaration consistency, and phase
 * count. `lintPlanStructure` composes these exactly as it composes the per-file
 * checks, so they run in `plan lint`, in the draft repair loop and inside
 * `plan grade` alike.
 *
 * A single plan (no overview, one implementable file) returns no findings and an
 * empty `clearedCreates`: it has no phase boundary to be inconsistent across.
 *
 * `clearedCreates` holds `<phase base>|<path>` keys for create paths an earlier
 * phase provably removes — the one case where this pass overrules a per-file
 * finding rather than adding to it.
 */
export const lintPlanCrossPhase = async ({ cwd, overview, phases, provenance, counts }: Params): Promise<CrossPhaseLintResult> => {
	if (overview === undefined && phases.length <= 1) {
		return { findings: [], clearedCreates: new Set<string>() };
	}

	const provenanceResult = await checkFileProvenance({ cwd, phases, provenance });
	const findings = [...provenanceResult.findings, ...checkPhaseHandoffs({ phases })];

	if (overview !== undefined) {
		const declarations = parsePhaseDeclarations({ plan: overview.plan });

		findings.push(
			...checkPhaseDeclarations({ declarations, phases, overviewBase: overview.base, counts }),
			...checkPhaseCount({ phaseCount: phases.length, overviewBase: overview.base }),
		);
	}

	return { findings, clearedCreates: provenanceResult.clearedCreates };
};
