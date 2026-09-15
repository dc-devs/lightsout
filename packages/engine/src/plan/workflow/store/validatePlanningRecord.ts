import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningGraphContext } from '#src/plan/workflow/store/common/types/PlanningGraphContext.ts';
import type { PlanningGraphIssue } from '#src/plan/workflow/store/common/types/PlanningGraphIssue.ts';
import { requirePlanningIds } from '#src/plan/workflow/store/common/validation/requirePlanningIds.ts';
import { validateLegacySettlements } from '#src/plan/workflow/store/common/validation/validateLegacySettlements.ts';
import { validatePlanningClaims } from '#src/plan/workflow/store/common/validation/validatePlanningClaims.ts';
import { validatePlanningWork } from '#src/plan/workflow/store/common/validation/validatePlanningWork.ts';

interface Params {
	record: PlanningRecord;
}

const checkUnique = ({ values, at, issues }: { values: string[]; at: string; issues: PlanningGraphIssue[] }) => {
	const seen = new Set<string>();
	for (const id of values) {
		if (seen.has(id)) issues.push({ at, message: `Duplicate identity ${id}` });
		seen.add(id);
	}
};

const checkScopes = ({ record, issues, claims, phases }: PlanningGraphContext) => {
	const scoped = [
		...record.claims.map((claim) => ({
			...claim,
			historicalPhases:
				(record.legacySettlements ?? [])
					.find((item) => item.id === claim.legacySettlementId)
					?.phaseBindings.flatMap((binding) => (binding.phaseId === null ? [] : [binding.phaseId])) ?? [],
		})),
		...[...record.work, ...record.findings].map((item) => ({ ...item, historicalPhases: [] })),
	];
	for (const value of scoped) {
		requirePlanningIds({ values: value.scope.claimIds, available: claims, at: `${value.id}.scope.claimIds`, issues });
		requirePlanningIds({ values: value.scope.phaseIds, available: new Set([...phases, ...value.historicalPhases]), at: `${value.id}.scope.phaseIds`, issues });
	}
	for (const confirmation of record.confirmations) {
		requirePlanningIds({ values: confirmation.delegation.claimIds, available: claims, at: `${confirmation.id}.delegation`, issues });
		requirePlanningIds({ values: confirmation.delegation.phaseIds, available: phases, at: `${confirmation.id}.delegation`, issues });
	}
	for (const artifact of record.artifacts) {
		requirePlanningIds({ values: artifact.claimIds, available: claims, at: `${artifact.path}.claimIds`, issues });
		requirePlanningIds({ values: artifact.prerequisiteIds, available: phases, at: `${artifact.path}.prerequisiteIds`, issues });
		if (artifact.variant === PlanningVocabulary.Artifact.Phase && artifact.phaseId === undefined)
			issues.push({ at: artifact.path, message: 'Phase artifact requires its stable phase ID' });
		if (artifact.variant !== PlanningVocabulary.Artifact.Phase && artifact.phaseId !== undefined)
			issues.push({ at: artifact.path, message: 'Only phase artifacts may establish a phase identity' });
		if (artifact.path === '.' || artifact.path === '.planning' || artifact.path.startsWith('.planning/'))
			issues.push({ at: artifact.path, message: 'An artifact cannot replace canonical storage' });
		if (artifact.phaseId !== undefined) requirePlanningIds({ values: [artifact.phaseId], available: phases, at: artifact.path, issues });
		requirePlanningIds({ values: artifact.boundaries.claimIds, available: claims, at: `${artifact.path}.boundaries`, issues });
		requirePlanningIds({ values: artifact.boundaries.phaseIds, available: phases, at: `${artifact.path}.boundaries`, issues });
	}
};

/** Structural graph validation rejects lost authority and dangling execution links without rejecting semantic cycles. */
export const validatePlanningRecord = ({ record: proposed }: Params): { valid: boolean; issues: PlanningGraphIssue[] } => {
	const parsed = PlanningRecord.safeParse(proposed);
	if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => ({ at: issue.path.join('.'), message: issue.message })) };
	const record = parsed.data;
	const issues: PlanningGraphIssue[] = [];
	const collections = {
		claims: record.claims,
		evidence: record.evidence,
		work: record.work,
		findings: record.findings,
		reviewReceipts: record.reviewReceipts,
		confirmations: record.confirmations,
		legacySettlements: record.legacySettlements ?? [],
	};
	for (const [at, values] of Object.entries(collections)) checkUnique({ values: values.map((value) => value.id), at, issues });
	checkUnique({ values: [...record.claims, ...record.evidence].map((item) => item.id), at: 'semantic-identities', issues });
	checkUnique({ values: record.standards.map((item) => item.channel), at: 'standards', issues });
	for (const standard of record.standards)
		if (!record.artifacts.some((artifact) => artifact.path === standard.artifact))
			issues.push({ at: standard.channel, message: 'Resolved standards artifact is missing' });
	checkUnique({ values: record.artifacts.map((artifact) => artifact.path), at: 'artifacts', issues });
	const phaseIds = record.artifacts
		.filter((artifact) => artifact.variant === PlanningVocabulary.Artifact.Phase)
		.flatMap((artifact) => (artifact.phaseId === undefined ? [] : [artifact.phaseId]));
	checkUnique({ values: phaseIds, at: 'phases', issues });
	for (const source of record.sources)
		if (sha256({ content: source.text }) !== source.sha256) issues.push({ at: source.artifact, message: 'Original source bytes do not match their digest' });
	const context = {
		record,
		issues,
		ids: new Set([...record.claims, ...record.evidence, ...record.evidence.flatMap((evidence) => evidence.dependencies)].map((value) => value.id)),
		claims: new Set(record.claims.map((claim) => claim.id)),
		phases: new Set(phaseIds),
		work: new Set(record.work.map((item) => item.id)),
		findings: new Set(record.findings.map((finding) => finding.id)),
		receipts: new Set(record.reviewReceipts.map((receipt) => receipt.id)),
	};
	validateLegacySettlements({ record, issues });
	validatePlanningClaims(context);
	checkScopes(context);
	validatePlanningWork(context);
	for (const evidence of record.evidence) {
		requirePlanningIds({ values: [evidence.assignmentId], available: context.work, at: `${evidence.id}.assignment`, issues });
		requirePlanningIds({ values: [...evidence.claimIds, ...evidence.uncertaintyIds], available: context.claims, at: `${evidence.id}.claims`, issues });
	}

	return { valid: issues.length === 0, issues };
};
