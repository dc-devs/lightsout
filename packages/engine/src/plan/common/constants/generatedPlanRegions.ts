/**
 * The `##` sections of a plan file the ENGINE composes from a record, rather
 * than an author writing them: the decision record composes the first two, the
 * phase record the last two.
 *
 * One declaration of a vocabulary several readers share — the section writers,
 * the structural lint and the grading fingerprint — so a region added later
 * reaches every one of them at once rather than being forgotten by whichever
 * reader nobody remembered to edit.
 *
 * `## Cross-Phase Dependencies` is deliberately absent: it is authored prose,
 * and a wrong entry here would drop design text out of a design hash.
 */
export const generatedPlanRegions = {
	decisionLog: 'Decision Log',
	globalConstraints: 'Global Constraints',
	phases: 'Phases',
	phaseDeclarations: 'Phase Declarations',
} as const;
