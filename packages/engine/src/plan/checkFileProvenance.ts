import { join } from 'node:path';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';
import type { CrossPhaseLintResult } from '#src/plan/common/types/CrossPhaseLintResult.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseProvenance } from '#src/plan/common/types/PhaseProvenance.ts';

interface Params {
	cwd: string;
	/** Implementable plan files, ordered by phase number. */
	phases: PhaseFile[];
	provenance: PhaseProvenance;
}

/** One provenance defect, before it is stamped with the phase that named the path. */
interface Defect {
	path: string;
	issue: string;
	fix: string;
}

/** Every provenance finding is blocking and points at the phase file that named the path. */
const stamp = ({ phase, defects }: { phase: PhaseFile; defects: Defect[] }): StructuralFinding[] =>
	defects.map(({ path, issue, fix }) => ({
		check: StructuralCheck.FileProvenance,
		severity: FindingSeverity.Blocking,
		phase: phase.base,
		issue,
		location: `${phase.base} → ${path}`,
		fix,
	}));

/** A path this phase names that a strictly earlier phase deleted or moved away, and nothing has supplied since. */
const removedDefects = ({ phase, removedBefore, removedBy }: { phase: PhaseFile; removedBefore: Set<string>; removedBy: Map<string, string> }) =>
	[...phase.plan.modifyPaths, ...phase.plan.earlierPhaseModifyPaths, ...phase.plan.deletePaths]
		.filter((path) => removedBefore.has(path))
		.map((path) => ({
			path,
			issue: `path is gone by this phase: ${removedBy.get(path) ?? 'an earlier phase'} already deletes or moves it away`,
			fix: 'drop this path, or have a phase recreate it before this one touches it',
		}));

/**
 * An earlier-phase modify names a file no earlier phase writes, so nothing puts
 * it there. A path an earlier phase removed is left to `removedDefects` — one
 * defect, reported by the rule that knows why the path is missing.
 */
const unsuppliedModifyDefects = ({ phase, providedBefore, removedBefore }: { phase: PhaseFile; providedBefore: Set<string>; removedBefore: Set<string> }) =>
	phase.plan.earlierPhaseModifyPaths
		.filter((path) => !providedBefore.has(path) && !removedBefore.has(path))
		.map((path) => ({
			path,
			issue: 'no earlier phase creates this path',
			fix: 'list it under `## Files to Modify` if it exists today, or have an earlier phase create it',
		}));

/** A modify names a file an earlier phase creates, so it is not on disk when the implementing agent opens it. */
const earlierPhaseDefects = ({ phase, providedBefore }: { phase: PhaseFile; providedBefore: Set<string> }) =>
	phase.plan.modifyPaths
		.filter((path) => providedBefore.has(path))
		.map((path) => ({
			path,
			issue: 'this file does not exist yet — an earlier phase creates it',
			fix: 'list it under `## Files to Modify from Earlier Phases`',
		}));

/**
 * A path this phase creates that another phase also creates. Skipped when a
 * removal falls between the two: the later create is then a recreate, which is
 * legitimate work rather than a collision.
 */
const collisionDefects = ({ phase, phases, provenance }: { phase: PhaseFile; phases: PhaseFile[]; provenance: PhaseProvenance }) => {
	const order = ({ base }: { base: string }) => phases.findIndex((candidate) => candidate.base === base);

	return [...phase.plan.createPaths, ...phase.plan.movePaths.map((move) => move.to)]
		.filter((path) => {
			const creator = provenance.createdBy.get(path);

			if (creator === undefined || creator === phase.base) {
				return false;
			}

			const later = order({ base: creator }) > order({ base: phase.base }) ? creator : phase.base;

			return !(provenance.removedBefore.get(later) ?? new Set<string>()).has(path);
		})
		.map((path) => ({
			path,
			issue: `two phases create this path: ${provenance.createdBy.get(path)} creates it too`,
			fix: 'let one phase create it and have the other list it under `## Files to Modify from Earlier Phases`',
		}));
};

/**
 * A delete or move source naming a path neither on disk nor supplied by an
 * earlier phase — there is nothing there to remove. A path an earlier phase
 * already removed is `removedDefects`' to report, not this one's.
 */
const missingRemovalDefects = async ({
	cwd,
	phase,
	providedBefore,
	removedBefore,
}: {
	cwd: string;
	phase: PhaseFile;
	providedBefore: Set<string>;
	removedBefore: Set<string>;
}) => {
	const defects: Defect[] = [];

	for (const path of [...phase.plan.deletePaths, ...phase.plan.movePaths.map((move) => move.from)]) {
		if (providedBefore.has(path) || removedBefore.has(path) || (await pathExists({ path: join(cwd, path) }))) {
			continue;
		}

		defects.push({
			path,
			issue: 'nothing supplies this path: it is not on disk and no earlier phase creates it',
			fix: 'correct the path — only a file that is there can be deleted or moved',
		});
	}

	return defects;
};

/**
 * FileProvenance — a phased plan's paths must trace to a phase that supplies
 * them. Reads the phase files directly rather than the overview's declaration,
 * because by lint time every phase file is on disk with its complete list, which
 * makes provenance exactly decidable instead of dependent on how complete the
 * declaration happens to be.
 *
 * It is the only check that knows which create paths an earlier phase removed,
 * so it is also the producer of `clearedCreates` — the `<phase base>|<path>`
 * keys `lintPlanStructure` uses to drop a per-file `path-exists` finding for a
 * legitimate delete-then-recreate. `lintPlanCrossPhase` passes the set straight
 * through; no other check contributes to it.
 */
export const checkFileProvenance = async ({ cwd, phases, provenance }: Params): Promise<CrossPhaseLintResult> => {
	const findings: StructuralFinding[] = [];
	const clearedCreates = new Set<string>();

	for (const phase of phases) {
		const providedBefore = provenance.providedBefore.get(phase.base) ?? new Set<string>();
		const removedBefore = provenance.removedBefore.get(phase.base) ?? new Set<string>();

		findings.push(
			...stamp({
				phase,
				defects: [
					...earlierPhaseDefects({ phase, providedBefore }),
					...removedDefects({ phase, removedBefore, removedBy: provenance.removedBy }),
					...unsuppliedModifyDefects({ phase, providedBefore, removedBefore }),
					...(await missingRemovalDefects({ cwd, phase, providedBefore, removedBefore })),
					...collisionDefects({ phase, phases, provenance }),
				],
			}),
		);

		for (const path of phase.plan.createPaths.filter((candidate) => removedBefore.has(candidate))) {
			clearedCreates.add(`${phase.base}|${path}`);
		}
	}

	return { findings, clearedCreates };
};
