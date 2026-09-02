import { readOverviewPhases } from '#src/phases/readOverviewPhases.ts';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';

interface GenerationFile {
	name: string;
	text: string;
}

/** The phase deliverables in a generation; durable working records are deliberately excluded. */
const phaseNamesOf = ({ names }: { names: string[] }) =>
	names.filter((name) => name !== 'plan.md' && name !== 'overview.md' && durablePlanFileNames.deliverable.test(name));

/**
 * The shared publish/restore runnable-generation invariant. Publish applies it
 * to the complete disk snapshot before mutation; restore applies it only after
 * the manifest-selected bytes have passed their hashes.
 */
export const validatePlanAttachmentGeneration = ({ files }: { files: GenerationFile[] }): { error: string } | undefined => {
	const names = files.map(({ name }) => name);
	const hasSingle = names.includes('plan.md');
	const hasOverview = names.includes('overview.md');
	const phases = phaseNamesOf({ names });

	if (hasSingle) {
		return hasOverview || phases.length > 0
			? { error: `the plan generation (${names.join(', ')}) is not runnable — plan.md must not coexist with overview.md or phase files` }
			: undefined;
	}

	if (!hasOverview || phases.length === 0) {
		return {
			error: `the plan generation (${names.join(', ')}) is not runnable — expected plan.md on its own, or overview.md with at least one phase<N> file`,
		};
	}

	const overview = files.find(({ name }) => name === 'overview.md');
	const declared = overview === undefined ? [] : readOverviewPhases({ overviewContent: overview.text });
	const duplicate = declared.find((name, index) => declared.indexOf(name) !== index);

	if (duplicate !== undefined) {
		return { error: `overview.md lists ${duplicate} more than once in its Phases table` };
	}

	const declaredSorted = [...declared].sort();
	const attachedSorted = [...phases].sort();

	if (declaredSorted.length !== attachedSorted.length || declaredSorted.some((name, index) => name !== attachedSorted[index])) {
		return {
			error: `overview.md's Phases table (${declared.join(', ') || 'none'}) does not exactly match the plan generation's phase files (${phases.join(', ')})`,
		};
	}

	return undefined;
};
