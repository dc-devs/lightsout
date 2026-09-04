import { basename } from 'node:path';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { type LightsoutConfig, type PhaseWeight, PlanWeight } from '#src/contracts/index.ts';
import { defaultWeightThresholds } from '#src/plan/common/constants/defaultWeightThresholds.ts';
import { computePlanWeight } from '#src/plan/common/grading/computePlanWeight.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	selected: DeliverableFile[];
	config?: LightsoutConfig;
}

/**
 * Weigh every selected plan file, so only the ones that earn the reader fan-out
 * pay for it. With `plan.contract` off nothing is weighed and every selected
 * file is read exactly as before the key existed.
 *
 * The weight is computed here rather than stamped at draft time because the
 * parsed plan carries what the decision turns on — the create paths, the
 * packages its paths sit in, whether it has a pattern to mirror — and the facts
 * a draft is written from carry no create paths at all.
 */
export const weighSelection = ({ selected, config }: Params): { weights: PhaseWeight[]; heavy: DeliverableFile[]; light: string[] } => {
	if (config?.plan?.contract !== true) {
		return { weights: [], heavy: selected, light: [] };
	}

	const declared = config.plan['weight-thresholds'];
	const thresholds = {
		createdFiles: declared?.['created-files'] ?? defaultWeightThresholds.createdFiles,
		packages: declared?.packages ?? defaultWeightThresholds.packages,
	};
	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const weights = selected.map((file) => {
		const base = basename(file.path);

		return computePlanWeight({ plan: parsePlan({ content: file.text, base }), phase: base, packagesDir, thresholds });
	});
	const heavyPhases = new Set(weights.filter(({ weight }) => weight === PlanWeight.Heavy).map(({ phase }) => phase));

	return {
		weights,
		heavy: selected.filter((file) => heavyPhases.has(basename(file.path))),
		light: weights.filter(({ weight }) => weight === PlanWeight.Light).map(({ phase }) => phase),
	};
};
