import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { FindingSeverity, type LightsoutConfig, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { checkPlanPaths } from '#src/plan/checkPlanPaths.ts';
import { checkVerificationScripts } from '#src/plan/checkVerificationScripts.ts';
import { PlanFileKind } from '#src/plan/common/constants/PlanFileKind.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseSizeCounts } from '#src/plan/common/types/PhaseSizeCounts.ts';
import { getPhaseProvenance } from '#src/plan/common/utils/getPhaseProvenance.ts';
import { getPlanNamedPaths } from '#src/plan/common/utils/getPlanNamedPaths.ts';
import { getPlanTouchedPaths } from '#src/plan/common/utils/getPlanTouchedPaths.ts';
import { lintPlanCrossPhase } from '#src/plan/lintPlanCrossPhase.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { scanPlaceholders } from '#src/plan/scanPlaceholders.ts';

interface Params {
	cwd: string;
	/** Absolute paths to the plan file(s) to lint. */
	planPaths: string[];
	config?: LightsoutConfig;
}

/** Required sections by variant — the fixed heading set the template pins. */
const requiredSections = {
	[PlanFileKind.Implementable]: ['Prerequisites', 'Global Constraints', 'Scope Boundaries', 'Verification', 'What Next Plan Expects'],
	[PlanFileKind.Overview]: ['Phases', 'Phase Declarations', 'Cross-Phase Dependencies', 'Global Constraints'],
} as const;

/** A phase file's position in the walk: `overview.md` precedes every phase, and a lone `plan.md` is phase one. */
const phaseNumber = ({ base }: { base: string }) => (base === 'overview.md' ? 0 : Number(/^phase(\d+)-/.exec(base)?.[1] ?? 1));

/** Read and parse every plan file once, so each check reads a `PhaseFile` rather than re-parsing the text. An unreadable file yields its finding here and no `PhaseFile` at all. */
const readPhaseFiles = async ({ planPaths }: { planPaths: string[] }) => {
	const phases: PhaseFile[] = [];
	const findings: StructuralFinding[] = [];

	for (const planPath of planPaths) {
		const content = await readFile(planPath, 'utf8').catch(() => undefined);
		const base = basename(planPath);

		if (content === undefined) {
			findings.push({
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				phase: base,
				issue: 'plan file could not be read',
				location: planPath,
				fix: 'ensure the draft wrote the plan file at this path',
			});

			continue;
		}

		phases.push({ path: planPath, base, number: phaseNumber({ base }), plan: parsePlan({ content, base }) });
	}

	return { phases, findings };
};

/** SectionsPresent — the required headings for this file's variant. */
const checkSections = ({ phase }: { phase: PhaseFile }) =>
	requiredSections[phase.plan.variant]
		.filter((section) => !phase.plan.sections.has(section))
		.map((section) => ({
			check: StructuralCheck.SectionsPresent,
			severity: FindingSeverity.Blocking,
			phase: phase.base,
			issue: `missing required section '## ${section}' (${phase.plan.variant} plan)`,
			location: phase.base,
			fix: `add a '## ${section}' section`,
		}));

/** NoPlaceholders — no unresolved marker survives into a written plan. */
const checkPlaceholders = ({ phase }: { phase: PhaseFile }) =>
	scanPlaceholders({ lines: phase.plan.lines }).map(({ label, line }) => ({
		check: StructuralCheck.NoPlaceholders,
		severity: FindingSeverity.Blocking,
		phase: phase.base,
		issue: `unresolved placeholder '${label}' present`,
		location: `${phase.base}:${line}`,
		fix: `resolve '${label}' — every open question must be decided before the plan is written`,
	}));

/** MoveWellFormed — a `## Files to Move` heading that did not name two paths, so the file it meant to move is nowhere in the parsed plan. */
const checkMoves = ({ phase }: { phase: PhaseFile }) =>
	phase.plan.malformedMoveLines.map((line) => ({
		check: StructuralCheck.MoveWellFormed,
		severity: FindingSeverity.Blocking,
		phase: phase.base,
		issue: 'a Files to Move heading does not name two paths',
		location: `${phase.base}:${line}`,
		fix: 'write the heading as an old path and a new path, each in backticks',
	}));

/**
 * The two size numbers. The created-file count is a real ceiling and is never
 * declarable; the touched count is advisory and measured against whatever this
 * plan declares for itself, because a phase that creates three files and renames
 * an import across two hundred is legitimate work one repo-wide number cannot
 * express.
 */
const checkSizes = ({ phase, fileLimit, counts }: { phase: PhaseFile; fileLimit: number; counts: PhaseSizeCounts }) => {
	const findings: StructuralFinding[] = [];
	const { created, touched } = counts;
	const budget = phase.plan.fileBudget ?? fileLimit;

	if (created > createdFileCeiling) {
		findings.push({
			check: StructuralCheck.CreatedFilesWithinCeiling,
			severity: FindingSeverity.Blocking,
			phase: phase.base,
			issue: `plan creates ${created} source files, over the ${createdFileCeiling}-file ceiling`,
			location: phase.base,
			fix: `split the phase so it creates no more than ${createdFileCeiling} files`,
		});
	}

	if (touched > budget) {
		const source = phase.plan.fileBudget === undefined ? 'the configured executor-file-limit' : "this plan's own ## File Budget";

		findings.push({
			check: StructuralCheck.ScopeWithinGuardrail,
			severity: FindingSeverity.Advisory,
			phase: phase.base,
			issue: `plan touches ${touched} source files, over the ${budget}-file limit from ${source}`,
			location: phase.base,
			fix: `legal, but the implementing agent stops at ${budget} files — a mostly-mechanical phase should declare a '## File Budget' covering its real touched count`,
		});
	}

	return findings;
};

/**
 * The script names available to each file's verification commands beyond the
 * manifests: what that phase and every earlier one declares it adds. A phase may
 * legitimately verify with a script only the plan creates, and the overview —
 * which stands for the whole deliverable — sees the union.
 */
const getDeclaredScripts = ({ overview, phases }: { overview?: PhaseFile; phases: PhaseFile[] }) => {
	const byPhase = new Map<string, Set<string>>();

	if (!overview) {
		return byPhase;
	}

	const declarations = parsePhaseDeclarations({ plan: overview.plan });
	const running = new Set<string>();

	for (const phase of phases) {
		for (const script of declarations.find((declaration) => declaration.file === phase.base)?.scripts ?? []) {
			running.add(script);
		}

		byPhase.set(phase.base, new Set(running));
	}

	byPhase.set(overview.base, new Set(declarations.flatMap((declaration) => declaration.scripts)));

	return byPhase;
};

/** A per-file `path-exists` finding the cross-phase pass overruled: a create path an earlier phase provably removes. */
const isCleared = ({ finding, clearedCreates }: { finding: StructuralFinding; clearedCreates: Set<string> }) =>
	finding.check === StructuralCheck.PathExists && clearedCreates.has(`${finding.phase}|${finding.location.split(' → ').at(-1)}`);

/** PackagesIdentifiable — a `packagesDir/` path must name a package segment. */
const checkPackages = ({ phase, packagesDir }: { phase: PhaseFile; packagesDir: string }) =>
	getPlanNamedPaths({ plan: phase.plan })
		.filter((path) => path.startsWith(`${packagesDir}/`) && !path.slice(packagesDir.length + 1).includes('/'))
		.map((path) => ({
			check: StructuralCheck.PackagesIdentifiable,
			severity: FindingSeverity.Blocking,
			phase: phase.base,
			issue: `path '${path}' is directly under ${packagesDir}/ with no package segment`,
			location: `${phase.base} → ${path}`,
			fix: `place the file under ${packagesDir}/<package>/…`,
		}));

/**
 * The deterministic structural lint — no agent. This is to plans what
 * `runStandardsCheck`'s checks are to code: it keys off the fixed structure the
 * plan template pins (the `##` heading set, the `###` create/modify/move
 * subheadings, the Patterns-to-Mirror bullet code spans, the Verification
 * command spans) and reports each defect as typed data.
 *
 * It runs parse-then-check: every plan path is read and parsed once into an
 * ordered `PhaseFile[]`, provenance is resolved across the implementable files,
 * and only then do the per-file checks run — each told which paths a strictly
 * earlier phase supplies, so a path phase 4 modifies because phase 1 creates it
 * no longer reads as a broken reference. That ordered set is also the seam the
 * cross-phase pass hangs off.
 *
 * Every path is `stat`ed, every verification script is looked up in a
 * package.json (honoring `config.gates` full-command overrides), placeholders
 * and required sections are matched textually, and the two size numbers are
 * checked: a blocking ceiling on the files a plan CREATES, and an advisory note
 * on every source file it touches. The `naming-matches` check no-ops without a
 * machine-checkable convention (the facts' `namingConvention` is free-text
 * prose), and `packages-identifiable` only fires on a malformed `packagesDir/`
 * path — both are conservative by design, never guessing.
 *
 * The per-file loop is followed by `lintPlanCrossPhase`, which needs more than
 * one plan file in view and is also the only pass allowed to overrule one: a
 * `path-exists` finding for a create path an earlier phase provably removes is
 * dropped, because delete-then-recreate is legitimate work the per-file check
 * cannot recognise on its own.
 */
export const lintPlanStructure = async ({ cwd, planPaths, config }: Params): Promise<StructuralFinding[]> => {
	const packagesDir = config?.['packages-dir'] ?? defaultPackagesDir;
	const fileLimit = config?.['executor-file-limit'] ?? defaultExecutorFileLimit;
	const configCommands = new Set(Object.values(config?.gates ?? {}).filter((value): value is string => typeof value === 'string'));
	const { phases, findings } = await readPhaseFiles({ planPaths });
	const overview = phases.find((file) => file.plan.variant === PlanFileKind.Overview);
	const implementable = phases.filter((file) => file.plan.variant !== PlanFileKind.Overview).sort((one, other) => one.number - other.number);
	const phased = implementable.length > 1 || overview !== undefined;
	const provenance = getPhaseProvenance({ phases: implementable });
	const declaredByPhase = getDeclaredScripts({ overview, phases: implementable });
	const counts = new Map<string, PhaseSizeCounts>();

	for (const phase of overview ? [overview, ...implementable] : implementable) {
		const provided = provenance.providedBefore.get(phase.base) ?? new Set<string>();
		const declaredScripts = declaredByPhase.get(phase.base) ?? new Set<string>();
		const shared = { plan: phase.plan, cwd, planPath: phase.path, phase: phase.base };
		const { created, touched } = getPlanTouchedPaths({ plan: phase.plan });
		const sizes = { created: created.length, touched: touched.length };

		counts.set(phase.base, sizes);

		findings.push(
			...checkSections({ phase }),
			...(await checkPlanPaths({ ...shared, provided, phased })),
			...(await checkVerificationScripts({ ...shared, packagesDir, configCommands, declaredScripts })),
			...checkPlaceholders({ phase }),
			...checkMoves({ phase }),
			...checkSizes({ phase, fileLimit, counts: sizes }),
			...checkPackages({ phase, packagesDir }),
		);
	}

	const crossPhase = await lintPlanCrossPhase({ cwd, overview, phases: implementable, provenance, counts });

	return [...findings.filter((finding) => !isCleared({ finding, clearedCreates: crossPhase.clearedCreates })), ...crossPhase.findings];
};
