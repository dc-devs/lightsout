import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';
import { renderPhaseSections } from '#src/plan/sections/renderPhaseSections.ts';
import { writePlanSection } from '#src/plan/sections/writePlanSection.ts';

interface Params {
	/** Absolute path of the overview whose two phase sections are rewritten. */
	overviewPath: string;
	/** The authoritative record, one row per phase, in phase order. */
	declarations: PhaseDeclaration[];
	/** Basenames of the deliverable's phase files. A declaration naming anything else is not rendered. */
	phaseFiles: string[];
}

/**
 * Regenerate an overview's `## Phases` table and `## Phase Declarations` blocks
 * from one phase record, so the two copies of a phase's size and hand-offs
 * cannot disagree.
 *
 * Each section is rendered whole rather than edited row by row, because the
 * defect this removes is two copies of one fact drifting apart: rendering both
 * from one record is the only shape in which they cannot. The consequence is
 * stated rather than hidden — prose an agent wrote inside either section does
 * not survive a sync, so neither section is a place for design text. The scope
 * and the declared creates, exports and scripts ride the record, so what the
 * agent decided survives the round trip.
 *
 * Only entries whose `number` is above zero and whose `file` is one of
 * `phaseFiles` are rendered. `parsePhaseDeclarations` deliberately preserves
 * malformed input — an orphan block comes back numbered zero, and a row may name
 * a file this deliverable does not have — and rendering one of those would write
 * a row and a heading no agent authored, replacing a clear orphan finding with a
 * confusing numbering one. Dropping it instead would delete agent-authored text
 * outright. Matching per entry is the only option that can neither fabricate nor
 * delete, and an empty matched set is a no-op rather than an empty render: two
 * sections rendered from nothing would wipe the scope text every phase writer
 * was authored against. What survives untouched reaches the round's lint and is
 * reported there as the structural defect it is.
 */
export const syncPhaseSections = async ({ overviewPath, declarations, phaseFiles }: Params): Promise<SyncedPlanFile> => {
	const known = new Set(phaseFiles);
	const matched = declarations.filter((declaration) => declaration.number > 0 && known.has(declaration.file));

	if (matched.length === 0) {
		return { path: overviewPath, updated: false };
	}

	const sections = renderPhaseSections({ declarations: matched });
	const phases = await writePlanSection({
		path: overviewPath,
		heading: 'Phases',
		section: sections.get('Phases') ?? '',
		after: 'Global Constraints',
	});
	const blocks = await writePlanSection({
		path: overviewPath,
		heading: 'Phase Declarations',
		section: sections.get('Phase Declarations') ?? '',
		after: 'Phases',
	});

	return { path: overviewPath, updated: phases.updated || blocks.updated };
};
