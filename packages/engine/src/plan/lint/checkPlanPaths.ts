import { basename, join } from 'node:path';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
	cwd: string;
	/** Absolute path to the plan file — its basename anchors each finding's location. */
	planPath: string;
	/** The finding label: this file's basename. */
	phase: string;
	/** Paths a strictly earlier phase creates or moves to — present in the finished repo, absent from disk today. */
	provided: Set<string>;
	/** True when the deliverable is a phased plan; a single plan has no predecessor to supply anything. */
	phased: boolean;
}

/** Where a finding points: the plan file's basename and the path it named. */
const locate = ({ planPath, path }: { planPath: string; path: string }) => `${basename(planPath)} → ${path}`;

/** Modify and mirror targets are stated as code that exists — on disk today, or supplied by a strictly earlier phase. */
const checkSuppliedPaths = async ({ plan, cwd, planPath, phase, provided }: Params) => {
	const findings: StructuralFinding[] = [];

	for (const path of [...plan.modifyPaths, ...plan.mirrorPaths]) {
		if (provided.has(path) || (await pathExists({ path: join(cwd, path) }))) {
			continue;
		}

		findings.push({
			check: StructuralCheck.PathExists,
			severity: FindingSeverity.Blocking,
			phase,
			issue: `referenced path does not exist: ${path}`,
			location: locate({ planPath, path }),
			fix: `correct the path or move it under Files to Create if it does not exist yet`,
		});
	}

	return findings;
};

/** A created file and a move destination are both new ground: neither may exist on disk, and neither may already be supplied by an earlier phase. */
const checkNewPaths = async ({ plan, cwd, planPath, phase, provided }: Params) => {
	const findings: StructuralFinding[] = [];
	const groups = [
		{ paths: plan.createPaths, label: 'Files to Create path' },
		{ paths: plan.movePaths.map((move) => move.to), label: 'Files to Move destination' },
	];

	for (const { paths, label } of groups) {
		for (const path of paths) {
			const exists = await pathExists({ path: join(cwd, path) });

			if (!exists && !provided.has(path)) {
				continue;
			}

			findings.push({
				check: StructuralCheck.PathExists,
				severity: FindingSeverity.Blocking,
				phase,
				issue: exists ? `${label} already exists: ${path}` : `an earlier phase already creates this path: ${path}`,
				location: locate({ planPath, path }),
				fix: exists ? `move it to Files to Modify, or choose a new path` : 'list it under `## Files to Modify from Earlier Phases`',
			});
		}
	}

	return findings;
};

/**
 * The paths whose absence is the point: an earlier-phase modify names a file no
 * phase has written yet, and a delete or move source names one that has to be
 * there to remove. A phased plan's deletes and move sources are
 * provenance-dependent — the file may be one an earlier phase creates — so they
 * are left to the cross-phase pass rather than judged against today's disk.
 */
const checkRemovedPaths = async ({ plan, cwd, planPath, phase, phased }: Params) => {
	const findings: StructuralFinding[] = [];

	for (const path of plan.earlierPhaseModifyPaths) {
		if (await pathExists({ path: join(cwd, path) })) {
			findings.push({
				check: StructuralCheck.PathExists,
				severity: FindingSeverity.Blocking,
				phase,
				issue: `Files to Modify from Earlier Phases path already exists: ${path}`,
				location: locate({ planPath, path }),
				fix: 'this file exists today — list it under `## Files to Modify`',
			});
		}
	}

	for (const path of phased ? [] : [...plan.deletePaths, ...plan.movePaths.map((move) => move.from)]) {
		if (!(await pathExists({ path: join(cwd, path) }))) {
			findings.push({
				check: StructuralCheck.PathExists,
				severity: FindingSeverity.Blocking,
				phase,
				issue: `referenced path does not exist: ${path}`,
				location: locate({ planPath, path }),
				fix: `correct the path — only a file that is there can be deleted or moved`,
			});
		}
	}

	return findings;
};

/**
 * PathExists — every path a plan names must hold the ground it claims. Modify
 * and mirror targets exist on disk or are supplied by a strictly earlier phase;
 * Files-to-Create paths and move destinations are new ground on both counts; an
 * earlier-phase modify must NOT exist yet; a single plan's deletes and move
 * sources must. Every path is `stat`ed, and each mismatch is reported as a typed
 * finding with a plan-relative location.
 */
export const checkPlanPaths = async (params: Params): Promise<StructuralFinding[]> => [
	...(await checkSuppliedPaths(params)),
	...(await checkNewPaths(params)),
	...(await checkRemovedPaths(params)),
];
