import { planTextEncodingMarker } from '#src/plan/common/constants/planTextEncodingMarker.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { renderPhaseDeclaration } from '#src/plan/sections/renderPhaseDeclaration.ts';
import { renderPhaseRow } from '#src/plan/sections/renderPhaseRow.ts';

interface Params {
	declarations: PhaseDeclaration[];
	lossless?: boolean;
}

/** The lead-in both sections carry, telling a reader they are composed rather than hand-written. */
const composedNote = "Composed by `lightsout plan draft` from this plan's phase files. Do not edit by hand.";

/** The `## Phases` section: its lead-in, the table's fixed header and separator, then one row per matched phase. */
const renderPhasesSection = ({ declarations, lossless }: { declarations: PhaseDeclaration[]; lossless?: boolean }) => {
	const headerRow = '| # | File | Scope | Creates | Touches |';
	const separatorRow = '|---|------|-------|---------|---------|';
	const rows = declarations.map((declaration) => renderPhaseRow({ declaration, lossless }));

	return `## Phases\n\n${composedNote}${lossless ? `\n\n${planTextEncodingMarker}` : ''}\n\n${[headerRow, separatorRow, ...rows].join('\n')}`;
};

/** The `## Phase Declarations` section: its lead-in, then one block per matched phase. */
const renderDeclarationsSection = ({ declarations, lossless }: { declarations: PhaseDeclaration[]; lossless?: boolean }) => {
	const blocks = declarations.map((declaration) => renderPhaseDeclaration({ declaration, lossless }));

	return `## Phase Declarations\n\n${composedNote}${lossless ? `\n\n${planTextEncodingMarker}` : ''}\n\n${blocks.join('\n\n')}`;
};

/** Render both linked phase sections from the same ordered declarations. */
export const renderPhaseSections = ({ declarations, lossless }: Params): Map<string, string> =>
	new Map([
		['Phases', renderPhasesSection({ declarations, lossless })],
		['Phase Declarations', renderDeclarationsSection({ declarations, lossless })],
	]);
