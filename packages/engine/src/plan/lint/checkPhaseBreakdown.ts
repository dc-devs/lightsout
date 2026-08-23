import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { checkPhaseCount } from '#src/plan/lint/checkPhaseCount.ts';
import { getDeclarationDefects } from '#src/plan/lint/common/utils/getDeclarationDefects.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** The overview file's text as the overview spawn wrote it. */
	overviewText: string;
	/** The overview's basename — every finding's phase label. */
	overviewBase: string;
	/** `executor-file-limit` from config, already defaulted by the caller. */
	executorFileLimit: number;
}

/** One breakdown defect, before the severity and phase label every one of them shares is stamped on. */
interface Defect {
	check: StructuralCheck;
	severity: StructuralFinding['severity'];
	issue: string;
	location: string;
	fix: string;
}

/**
 * Every `### Phase <n> — ` block header in the declarations section, read from
 * the section text rather than from the parsed rows: a phase whose block is
 * absent parses identically to one whose bullets all read `none`, and only one
 * of those two is a defect.
 */
const declaredBlockFiles = ({ plan }: { plan: ParsedPlan }) => {
	const files = new Set<string>();

	for (const line of plan.sections.get('Phase Declarations') ?? []) {
		const header = /^###\s+Phase\s+\d+\s*[—–-]\s*`([^`]+)`/.exec(line);

		if (header) {
			files.add(header[1].trim());
		}
	}

	return files;
};

/** The breakdown exists at all: a table with rows, and a declaration block behind every row. */
const sectionDefects = ({ plan, declarations }: { plan: ParsedPlan; declarations: PhaseDeclaration[] }) => {
	const defects: Defect[] = [];
	const shared = { check: StructuralCheck.SectionsPresent, severity: FindingSeverity.Blocking };

	if (declarations.length === 0) {
		defects.push({
			...shared,
			issue: "the '## Phases' table declares no phases",
			location: 'Phases',
			fix: "write one '## Phases' row per phase: its number, its `phase<N>-<slug>.md` filename, a one-line scope, and its Creates and Touches counts",
		});

		return defects;
	}

	const blocks = declaredBlockFiles({ plan });

	for (const declaration of declarations.filter((candidate) => !blocks.has(candidate.file))) {
		defects.push({
			...shared,
			issue: `'## Phase Declarations' has no block for ${declaration.file}`,
			location: 'Phase Declarations',
			fix: `add a '### Phase ${declaration.number} — \`${declaration.file}\`' block with its Creates, Exports and Scripts bullets`,
		});
	}

	return defects;
};

/** The numbering runs 1..n with no gaps, and every row's filename agrees with its number — the declaration-only rules, located relative to the overview. */
const shapeDefects = ({ declarations }: { declarations: PhaseDeclaration[] }) =>
	getDeclarationDefects({
		declarations,
		locations: {
			declarationsSection: 'Phase Declarations',
			phasesTable: 'Phases',
			phaseRow: (file) => `Phases → ${file}`,
		},
	}).map((defect) => ({ check: StructuralCheck.DeclarationConsistent, severity: FindingSeverity.Blocking, ...defect }));

/**
 * The two size numbers, read from the declaration alone. This is the only
 * created-file check that runs before any phase file exists, so a count that
 * cannot be read has to stop the run rather than wave the phase through — the
 * reshaper's job then includes writing a real number.
 */
const sizeDefects = ({ declarations, executorFileLimit }: { declarations: PhaseDeclaration[]; executorFileLimit: number }) => {
	const defects: Defect[] = [];

	for (const declaration of declarations) {
		const { file, createdCount, touchedCount, fileBudget } = declaration;
		const budget = fileBudget ?? executorFileLimit;

		for (const { label } of [
			{ label: 'Creates', count: createdCount },
			{ label: 'Touches', count: touchedCount },
		].filter((cell) => cell.count === undefined)) {
			defects.push({
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				issue: `the '${label}' count for ${file} is missing or not an integer`,
				location: 'Phases',
				fix: `state how many source files ${file} ${label === 'Creates' ? 'creates' : 'touches'}, as an integer`,
			});
		}

		if (createdCount !== undefined && createdCount > createdFileCeiling) {
			defects.push({
				check: StructuralCheck.CreatedFilesWithinCeiling,
				severity: FindingSeverity.Blocking,
				issue: `${file} is declared to create ${createdCount} source files, over the ${createdFileCeiling}-file ceiling`,
				location: `Phases → ${file}`,
				fix: `split this phase into two in the '## Phases' table and '## Phase Declarations'`,
			});
		}

		if (touchedCount !== undefined && touchedCount > budget) {
			const source = fileBudget === undefined ? 'the configured executor-file-limit' : `${file}'s own declared file budget`;

			defects.push({
				check: StructuralCheck.ScopeWithinGuardrail,
				severity: FindingSeverity.Advisory,
				issue: `${file} is declared to touch ${touchedCount} source files, over the ${budget}-file limit from ${source}`,
				location: `Phases → ${file}`,
				fix: `legal, but the implementing agent stops at ${budget} files — a mostly-mechanical phase should declare a file budget covering its real touched count`,
			});
		}
	}

	return defects;
};

/**
 * Check a freshly-authored overview's phase breakdown against the size numbers,
 * reading only what the overview declares. This runs immediately after the
 * overview spawn and before any phase file is drafted, which is the cheapest
 * moment a plan can be refused: the alternative is discovering an unbuildable
 * phase after ten phase spawns have been paid for.
 */
export const checkPhaseBreakdown = ({ overviewText, overviewBase, executorFileLimit }: Params): StructuralFinding[] => {
	const plan = parsePlan({ content: overviewText, base: overviewBase });
	const declarations = parsePhaseDeclarations({ plan });
	const defects = [...sectionDefects({ plan, declarations }), ...shapeDefects({ declarations }), ...sizeDefects({ declarations, executorFileLimit })];

	return [
		...defects.map((defect) => ({ ...defect, phase: overviewBase, location: `${overviewBase} → ${defect.location}` })),
		...checkPhaseCount({ phaseCount: declarations.filter((declaration) => declaration.number > 0).length, overviewBase }),
	];
};
