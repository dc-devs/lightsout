import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { getExportName } from '#src/plan/common/naming/getExportName.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseSizeCounts } from '#src/plan/common/types/PhaseSizeCounts.ts';
import { getCodeSpans } from '#src/plan/common/utils/getCodeSpans.ts';

interface Params {
	/** Rows parsed from the overview. */
	declarations: PhaseDeclaration[];
	/** Implementable plan files, ordered by phase number. */
	phases: PhaseFile[];
	/** The overview's basename — the finding label for a declaration-side defect. */
	overviewBase: string;
	/** Source-file counts per phase basename, as the lint already computes them. */
	counts: Map<string, PhaseSizeCounts>;
}

/** One inconsistency, before the check and severity every one of them shares is stamped on. */
interface Defect {
	phase: string;
	issue: string;
	location: string;
	fix: string;
}

/** Every declaration defect is blocking; only the file it is reported against varies. */
const stamp = ({ defects }: { defects: Defect[] }): StructuralFinding[] =>
	defects.map((defect) => ({ check: StructuralCheck.DeclarationConsistent, severity: FindingSeverity.Blocking, ...defect }));

/** Every backticked span in a phase file, plus the export name of every path it creates — the two ways a declared name may appear. */
const namesIn = ({ phase }: { phase: PhaseFile }) => {
	const spans = new Set<string>();

	for (const line of phase.plan.lines) {
		for (const span of getCodeSpans({ line })) {
			spans.add(span);
		}
	}

	return { spans, exports: new Set(phase.plan.createPaths.map((path) => getExportName({ path }))) };
};

/** The declaration set and the phase-file set must name each other exactly, and the numbering must read 1..n. */
const phaseSetDefects = ({ declarations, phases, overviewBase }: Omit<Params, 'counts'>) => {
	const defects: Defect[] = [];
	const numbered = declarations.filter((declaration) => declaration.number > 0);
	const numbers = numbered.map((declaration) => declaration.number).sort((one, other) => one - other);

	for (const declaration of declarations.filter((candidate) => !phases.some((phase) => phase.base === candidate.file))) {
		defects.push({
			phase: overviewBase,
			issue: `the phase breakdown declares '${declaration.file}', which is not one of this plan's phase files`,
			location: `${overviewBase} → ${declaration.file}`,
			fix: 'correct the filename, or drop the row and its declaration block',
		});
	}

	for (const phase of phases.filter((candidate) => !declarations.some((declaration) => declaration.file === candidate.base))) {
		defects.push({
			phase: phase.base,
			issue: "this phase file has no row in the overview's phase breakdown",
			location: phase.base,
			fix: `add a '## Phases' row and a '## Phase Declarations' block for ${phase.base}`,
		});
	}

	for (const declaration of declarations.filter((candidate) => candidate.number === 0)) {
		defects.push({
			phase: overviewBase,
			issue: `'## Phase Declarations' has a block for '${declaration.file}', which the '## Phases' table does not list`,
			location: `${overviewBase} → Phase Declarations`,
			fix: `add a '## Phases' row for ${declaration.file}, or delete the orphan block`,
		});
	}

	if (numbers.some((number, index) => number !== index + 1)) {
		defects.push({
			phase: overviewBase,
			issue: `the phase numbers are ${numbers.join(', ')} rather than 1 to ${numbers.length} with no gaps or duplicates`,
			location: `${overviewBase} → Phases`,
			fix: 'renumber the phases so they run 1..n in table order',
		});
	}

	for (const declaration of numbered.filter((candidate) => !new RegExp(`^phase${candidate.number}-.+\\.md$`).test(candidate.file))) {
		defects.push({
			phase: overviewBase,
			issue: `phase ${declaration.number} is declared in '${declaration.file}', whose name does not read phase${declaration.number}-<slug>.md`,
			location: `${overviewBase} → ${declaration.file}`,
			fix: 'rename the file or the row so the number and the filename agree',
		});
	}

	return defects;
};

/** The declared counts and file budget, against the phase file the declaration describes. */
const numberDefects = ({
	declaration,
	phase,
	overviewBase,
	counts,
}: {
	declaration: PhaseDeclaration;
	phase: PhaseFile;
	overviewBase: string;
	counts: Map<string, PhaseSizeCounts>;
}) => {
	const defects: Defect[] = [];
	const actual = counts.get(phase.base);
	const declaredCounts = [
		{ label: 'creates', declared: declaration.createdCount, real: actual?.created },
		{ label: 'touches', declared: declaration.touchedCount, real: actual?.touched },
	];

	for (const { label, declared, real } of declaredCounts) {
		if (declared === undefined) {
			defects.push({
				phase: overviewBase,
				issue: `the '${label}' count for ${declaration.file} is missing or not an integer`,
				location: `${overviewBase} → Phases`,
				fix: `state how many source files ${declaration.file} ${label}, as an integer`,
			});
		} else if (real !== undefined && declared !== real) {
			defects.push({
				phase: overviewBase,
				issue: `${declaration.file} is declared to ${label} ${declared} source files, but its own file lists ${real}`,
				location: `${overviewBase} → Phases`,
				fix: `state ${real}, or change ${declaration.file} to match the declaration`,
			});
		}
	}

	if (declaration.fileBudget !== phase.plan.fileBudget) {
		defects.push({
			phase: overviewBase,
			issue: `the file budget declared for ${declaration.file} (${declaration.fileBudget ?? 'none'}) is not its own '## File Budget' (${phase.plan.fileBudget ?? 'none'})`,
			location: `${overviewBase} → Phase Declarations`,
			fix: 'the two copies must agree — the door check reads the overview, the implementing agent is handed the phase file',
		});
	}

	if (declaration.fileBudget !== undefined && declaration.touchedCount !== undefined && declaration.fileBudget < declaration.touchedCount) {
		defects.push({
			phase: overviewBase,
			issue: `the file budget declared for ${declaration.file} (${declaration.fileBudget}) is below its own touched count (${declaration.touchedCount})`,
			location: `${overviewBase} → Phase Declarations`,
			fix: `raise the budget to at least ${declaration.touchedCount} — a budget under the phase's own work refuses it at implement time`,
		});
	}

	return defects;
};

/** The names a declaration hands forward, against the phase file it describes. */
const nameDefects = ({ declaration, phase, overviewBase }: { declaration: PhaseDeclaration; phase: PhaseFile; overviewBase: string }) => {
	const defects: Defect[] = [];
	const { spans, exports } = namesIn({ phase });
	const written = new Set([...phase.plan.createPaths, ...phase.plan.movePaths.map((move) => move.to)]);

	for (const path of declaration.creates.filter((candidate) => !written.has(candidate))) {
		defects.push({
			phase: overviewBase,
			issue: `${declaration.file} is declared to create '${path}', which it lists under neither Files to Create nor Files to Move`,
			location: `${overviewBase} → ${declaration.file}`,
			fix: `add '${path}' to ${declaration.file}, or drop it from the declaration`,
		});
	}

	for (const name of declaration.exports.filter((candidate) => !spans.has(candidate) && !exports.has(candidate))) {
		defects.push({
			phase: overviewBase,
			issue: `${declaration.file} is declared to export '${name}', which appears nowhere in that phase file`,
			location: `${overviewBase} → ${declaration.file}`,
			fix: `have ${declaration.file} define '${name}', or drop it from the declaration`,
		});
	}

	for (const script of declaration.scripts.filter((candidate) => !spans.has(candidate))) {
		defects.push({
			phase: overviewBase,
			issue: `${declaration.file} is declared to add the script '${script}', which appears nowhere in that phase file`,
			location: `${overviewBase} → ${declaration.file}`,
			fix: `have ${declaration.file} add '${script}', or drop it from the declaration`,
		});
	}

	return defects;
};

/**
 * DeclarationConsistent — anything a phase declares in the overview must appear
 * in that phase's own file, and the two must agree about the phase set and its
 * sizes. This is the rule that keeps the declaration honest: the provenance
 * check reads the phase files, so without this the declaration could quietly
 * describe a plan that no longer exists.
 */
export const checkPhaseDeclarations = ({ declarations, phases, overviewBase, counts }: Params): StructuralFinding[] => {
	const defects = phaseSetDefects({ declarations, phases, overviewBase });

	for (const declaration of declarations) {
		const phase = phases.find((candidate) => candidate.base === declaration.file);

		if (phase) {
			defects.push(...numberDefects({ declaration, phase, overviewBase, counts }), ...nameDefects({ declaration, phase, overviewBase }));
		}
	}

	return stamp({ defects });
};
