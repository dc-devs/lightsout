import type { StructuralFinding } from '#src/contracts/index.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';

interface Params {
	/** Rows parsed from the overview, orphan blocks included. */
	declarations: PhaseDeclaration[];
	/** What the calling check calls each place a defect points at — the one thing the two spellings of these rules differ by. */
	locations: {
		/** The '## Phase Declarations' section. */
		declarationsSection: string;
		/** The '## Phases' table. */
		phasesTable: string;
		/** One declared phase file's row. */
		phaseRow: (file: string) => string;
	};
}

/**
 * The three declaration-consistency rules decidable from the overview alone: no
 * orphan declaration block, the phase numbers read 1..n, and every filename
 * agrees with its number.
 *
 * Spelled once because both declaration checks run them — the breakdown check
 * before any phase file exists, the consistency check after — and
 * `getFindingSetKey` keys the repair loop's no-progress detection on
 * `check|issue`. Two copies drifting by a word makes the reshape loop and the
 * structural loop stop recognising the same finding as the same finding.
 *
 * The severity and the phase label are the caller's to stamp: every one of these
 * is blocking, but which file a defect is reported against depends on which
 * check found it.
 */
export const getDeclarationDefects = ({ declarations, locations }: Params): Pick<StructuralFinding, 'issue' | 'location' | 'fix'>[] => {
	const defects: Pick<StructuralFinding, 'issue' | 'location' | 'fix'>[] = [];
	const numbered = declarations.filter((declaration) => declaration.number > 0);
	const numbers = numbered.map((declaration) => declaration.number).sort((one, other) => one - other);

	for (const declaration of declarations.filter((candidate) => candidate.number === 0)) {
		defects.push({
			issue: `'## Phase Declarations' has a block for '${declaration.file}', which the '## Phases' table does not list`,
			location: locations.declarationsSection,
			fix: `add a '## Phases' row for ${declaration.file}, or delete the orphan block`,
		});
	}

	if (numbers.some((number, index) => number !== index + 1)) {
		defects.push({
			issue: `the phase numbers are ${numbers.join(', ')} rather than 1 to ${numbers.length} with no gaps or duplicates`,
			location: locations.phasesTable,
			fix: 'renumber the phases so they run 1..n in table order',
		});
	}

	for (const declaration of numbered.filter((candidate) => !new RegExp(`^phase${candidate.number}-.+\\.md$`).test(candidate.file))) {
		defects.push({
			issue: `phase ${declaration.number} is declared in '${declaration.file}', whose name does not read phase${declaration.number}-<slug>.md`,
			location: locations.phaseRow(declaration.file),
			fix: 'rename the file or the row so the number and the filename agree',
		});
	}

	return defects;
};
