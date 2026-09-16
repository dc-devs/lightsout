import { applyPromptTokens } from '#src/agents/common/utils/applyPromptTokens.ts';
import { documentationRule } from '#src/agents/common/utils/documentationRule.ts';
import { documentationSection } from '#src/agents/common/utils/documentationSection.ts';
import focusedPlanContractTemplate from '#src/agents/prompts/focusedPlanContractTemplate.md';
import { planningEngineSections } from '#src/common/constants/planningEngineSections.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type ConfigDocs, PlanVariant } from '#src/contracts/index.ts';

interface Params {
	authoritativePacket: { systemPrompt: string; prompt: string };
	outputs: { path: string; variant: PlanVariant }[];
	limits: { executorFileLimit: number; createdFileCeiling: number };
	docs?: ConfigDocs;
}

const selectTemplate = ({ variants }: { variants: PlanVariant[] }) => {
	const headings = ['Single Plan', 'Overview Plan', 'Phase Plan'];
	const starts = headings.map((heading) => {
		const marker = `\n## ${heading}\n`;
		const start = focusedPlanContractTemplate.indexOf(marker);
		if (start < 0 || focusedPlanContractTemplate.indexOf(marker, start + marker.length) >= 0)
			throw new Error(`Focused template requires exactly one ${heading} variant boundary`);
		return start;
	});
	if (!(starts[0] < starts[1] && starts[1] < starts[2])) throw new Error('Focused template variant boundaries are out of order');
	const selected = [focusedPlanContractTemplate.slice(0, starts[0])];
	if (variants.includes(PlanVariant.Single) || variants.includes(PlanVariant.Phase)) selected.push(focusedPlanContractTemplate.slice(starts[0], starts[1]));
	if (variants.includes(PlanVariant.Overview)) selected.push(focusedPlanContractTemplate.slice(starts[1], starts[2]));
	if (variants.includes(PlanVariant.Phase)) selected.push(focusedPlanContractTemplate.slice(starts[2]));
	return selected.join('\n\n');
};

/** Reuse focused template constraints around one authoritative scoped packet; publication and verification remain engine-owned. */
export const buildAuthoritativePlanInvocation = ({ authoritativePacket, outputs, limits, docs }: Params): { systemPrompt: string; prompt: string } => {
	const template = applyPromptTokens({
		text: selectTemplate({ variants: outputs.map((output) => output.variant) }),
		tokens: {
			fileLimit: limits.executorFileLimit,
			createdFileCeiling: limits.createdFileCeiling,
			documentationRule: documentationRule({ docs }),
		},
	});
	const brief = [
		'# Authoritative planning author',
		'Use the original sources, current claims, shared contracts, acquired evidence and exact standards in the bound packet. Preserve approved intent; request missing evidence using the provided response schema.',
		'Author only the assigned new or affected artifacts. Preserve every unchanged sibling. A phase split retains established phase identities and changes only affected explicit layouts and dependencies.',
		'The template specifies structure and constraints. The active PlanningRoleResult schema governs output: return transactional artifactEdits and permitted claim/layout proposals. The engine stages and publishes them after validating current authority; do not write final files, run commands, or return a legacy PlanDraftReport.',
		`The engine owns these derived sections: ${planningEngineSections.join(', ')}. Leave new sections empty, and preserve existing generated sections exactly. Propose the source claims/layout fields instead of duplicating their rows. Unrecognized authored content must be retained or explicitly represented before replacement.`,
		'Acceptance behavior must be explicit typed acceptance claims: exact test file, test name and gate, or justified prose with verification. Link them to the original obligations and responsible artifacts. Do not substitute a summary or a coverage count for those obligations.',
		'Keep complete shared signatures, failure and ordering invariants, boundaries, and implementation-specific prose that the generated sections cannot express. Private helper choices remain delegated within the recorded constraints.',
	].join('\n\n');
	return {
		systemPrompt: [authoritativePacket.systemPrompt, template, docs?.length ? documentationSection({ docs }) : '', brief].filter(Boolean).join('\n\n'),
		prompt: canonicalJson({ value: { ...JSON.parse(authoritativePacket.prompt), authoring: { outputs, engineOwnedSections: planningEngineSections } } }),
	};
};
