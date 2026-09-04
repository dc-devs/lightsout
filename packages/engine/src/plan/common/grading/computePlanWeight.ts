import { packageOf } from '#src/common/workspace/packageOf.ts';
import { type PhaseWeight, PlanWeight } from '#src/contracts/index.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { getPlanTouchedPaths } from '#src/plan/common/utils/getPlanTouchedPaths.ts';

interface Params {
	plan: ParsedPlan;
	/** The plan file's basename, for the report. */
	phase: string;
	/** Directory prefix each package lives under (`packages` by default). */
	packagesDir: string;
	/** The counts above which this file is heavy, already merged over `defaultWeightThresholds`. */
	thresholds: { createdFiles: number; packages: number };
}

/** How many packages a plan file reaches into. A path under no package is the repository root, which is one package like any other. */
const countPackages = ({ touched, packagesDir }: { touched: string[]; packagesDir: string }) =>
	new Set(touched.map((file) => packageOf({ file, packagesDir }) ?? '<root>')).size;

/**
 * Weigh one parsed plan file: heavy enough to earn the reader fan-out, or light
 * enough that the structural lint and the ledger check are the whole grade.
 *
 * The numbers come from the plan rather than from the facts, which is the one
 * place this differs from `estimatePlanScope`: that runs at draft time, before
 * any plan exists, so the facts are all it has and they carry no create paths at
 * all. By grade time the plan itself is the better record.
 *
 * A file with nothing to mirror is always heavy, whatever its counts. That is
 * not a threshold and has no key: a plan following an existing pattern is
 * checkable against that pattern, and a plan following none is exactly where a
 * reader earns its cost.
 */
export const computePlanWeight = ({ plan, phase, packagesDir, thresholds }: Params): PhaseWeight => {
	const { created, touched } = getPlanTouchedPaths({ plan });
	const packages = countPackages({ touched, packagesDir });
	const reasons: string[] = [];

	if (created.length > thresholds.createdFiles) {
		reasons.push(`creates ${created.length} source files, above ${thresholds.createdFiles}`);
	}

	if (packages > thresholds.packages) {
		reasons.push(`touches ${packages} packages, above ${thresholds.packages}`);
	}

	if (plan.mirrorPaths.length === 0) {
		reasons.push('names no pattern to mirror');
	}

	return { phase, weight: reasons.length === 0 ? PlanWeight.Light : PlanWeight.Heavy, reasons };
};
