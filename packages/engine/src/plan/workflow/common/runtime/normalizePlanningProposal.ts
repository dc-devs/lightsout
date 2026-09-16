import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningClaim, type PlanningRecord, type PlanningRoleResult, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningScopeContains } from '#src/plan/workflow/common/utils/planningScopeContains.ts';

interface Params {
	record: PlanningRecord;
	result: PlanningRoleResult;
}

const mapClaims = ({
	record,
	result,
	mapped,
	id,
	scope,
}: {
	record: PlanningRecord;
	result: PlanningRoleResult;
	mapped: PlanningRoleResult;
	id: (params: { value: string }) => string;
	scope: (params: { value: PlanningScope }) => PlanningScope;
}): void => {
	if ('claims' in mapped)
		mapped.claims = mapped.claims.map((claim) => {
			if (claim.kind === PlanningVocabulary.ClaimKind.Question && claim.question.answerId !== undefined)
				throw new Error('Only an explicit foreground answer can establish a question answer link');
			const origin = record.sources.find(
				(source) => source.artifact === claim.origin.artifact && source.locator === claim.origin.locator && source.sha256 === claim.origin.sha256,
			);
			if (!origin || ('text' in claim.origin && claim.origin.text !== origin.text)) throw new Error('Claim origin is not captured original evidence');
			const assignment = record.work.find((work) => work.id === result.workId);
			if (!assignment) throw new Error('Proposal has no assigned work');
			if (!planningScopeContains({ outer: assignment.scope, inner: scope({ value: claim.scope }) }))
				throw new Error('A claim proposal exceeds its assigned scope; report outside-scope concerns as findings or work');
			const previous = record.claims.find((item) => item.id === claim.id);
			if (previous?.owner === PlanningVocabulary.Owner.User || previous?.confirmationId !== undefined || previous?.legacySettlementId !== undefined)
				throw new Error('A role cannot rewrite a user-owned claim or approved historical meaning');
			return PlanningClaim.parse({
				...claim,
				id: id({ value: claim.id }),
				contentRevision: (previous?.contentRevision ?? 0) + 1,
				origin,
				scope: scope({ value: claim.scope }),
				dependencies: claim.dependencies.map((value) => id({ value })),
				...(claim.supersedes ? { supersedes: id({ value: claim.supersedes }) } : {}),
			});
		});
};

const mapWork = ({
	record,
	result,
	mapped,
	id,
	scope,
	existing,
}: {
	record: PlanningRecord;
	result: PlanningRoleResult;
	mapped: PlanningRoleResult;
	id: (params: { value: string }) => string;
	scope: (params: { value: PlanningScope }) => PlanningScope;
	existing: Set<string>;
}): void => {
	if ('work' in mapped)
		mapped.work = mapped.work.map((work) => {
			if (work.role === PlanningVocabulary.Role.Adjudicate)
				throw new Error('Request adjudication through an explicit cited dispute, not an unconditional work item');
			if (existing.has(work.id)) throw new Error('A role cannot replace an existing work item');
			const parent = record.work.find((item) => item.id === result.workId);
			if (!parent) throw new Error('Proposal has no parent assignment');
			const predecessors = record.work
				.filter(
					(item) =>
						item.stage === parent.stage &&
						(work.role === PlanningVocabulary.Role.Draft
							? item.role === PlanningVocabulary.Role.DesignReview
							: work.role === PlanningVocabulary.Role.IntegrationReview
								? item.role === PlanningVocabulary.Role.ImplementationReview
								: false),
				)
				.map((item) => item.id);
			return {
				...work,
				id: id({ value: work.id }),
				stage: parent.stage,
				scope: scope({ value: work.scope }),
				prerequisiteIds: [...new Set([...work.prerequisiteIds.map((value) => id({ value })), ...predecessors])],
				inputDigest: sha256({ content: canonicalJson({ value: { assignment: work.assignment, scope: scope({ value: work.scope }) } }) }),
			};
		});
};

/** Resolve compact origins and engine-scope every new alias, rewriting linked identities together. */
export const normalizePlanningProposal = ({ record, result }: Params): PlanningRoleResult => {
	if (result.kind !== PlanningVocabulary.ResultKind.Terminal) throw new Error('Nonterminal evidence is not a completion proposal');
	const aliases = new Map<string, string>();
	const existing = new Set([...record.claims, ...record.evidence, ...record.findings, ...record.work].map((item) => item.id));
	const register = ({ id, kind }: { id: string; kind: string }) => {
		if (aliases.has(id)) throw new Error(`Ambiguous planning proposal alias: ${id}`);
		aliases.set(id, existing.has(id) ? id : `${kind}:${result.attemptId}:${sha256({ content: id })}`);
	};
	for (const [kind, rows] of [
		['claim', 'claims' in result ? result.claims : []],
		['evidence', 'evidence' in result ? result.evidence : []],
		['finding', 'findings' in result ? result.findings : []],
		['work', 'work' in result ? result.work : []],
	] as const)
		for (const row of rows) register({ id: row.id, kind });
	const phases = new Set(record.artifacts.flatMap((artifact) => (artifact.phaseId ? [artifact.phaseId] : [])));
	if ('artifactLayouts' in result)
		for (const layout of result.artifactLayouts ?? []) if (layout.phaseId && !phases.has(layout.phaseId)) register({ id: layout.phaseId, kind: 'phase' });
	const id = ({ value }: { value: string }) => aliases.get(value) ?? value;
	const scope = ({ value }: { value: PlanningScope }): PlanningScope => ({
		...value,
		claimIds: value.claimIds.map((value) => id({ value })),
		phaseIds: value.phaseIds.map((value) => id({ value })),
	});
	const mapped = structuredClone(result);
	mapClaims({ record, result, mapped, id, scope });
	if ('evidence' in mapped)
		mapped.evidence = mapped.evidence.map((evidence) => ({
			...evidence,
			id: id({ value: evidence.id }),
			assignmentId: result.workId,
			claimIds: evidence.claimIds.map((value) => id({ value })),
			uncertaintyIds: evidence.uncertaintyIds.map((value) => id({ value })),
		}));
	if ('findings' in mapped)
		mapped.findings = mapped.findings.map((finding) => {
			if (existing.has(finding.id)) throw new Error('New observations cannot overwrite an existing finding');
			return {
				...finding,
				id: id({ value: finding.id }),
				observationIds: finding.observationIds.map((value) => `${result.attemptId}:${value}`),
				scope: scope({ value: finding.scope }),
			};
		});
	mapWork({ record, result, mapped, id, scope, existing });
	if ('artifactLayouts' in mapped)
		mapped.artifactLayouts = mapped.artifactLayouts?.map((layout) => ({
			...layout,
			...(layout.phaseId ? { phaseId: id({ value: layout.phaseId }) } : {}),
			claimIds: layout.claimIds.map((value) => id({ value })),
			prerequisiteIds: layout.prerequisiteIds.map((value) => id({ value })),
			boundaries: scope({ value: layout.boundaries }),
		}));
	if ('coverage' in mapped)
		mapped.coverage = {
			...mapped.coverage,
			claimIds: mapped.coverage.claimIds.map((value) => id({ value })),
			phaseIds: mapped.coverage.phaseIds.map((value) => id({ value })),
		};
	if ('resolutions' in mapped)
		mapped.resolutions = mapped.resolutions.map((resolution) => ({
			...resolution,
			findingId: id({ value: resolution.findingId }),
			claimIds: resolution.claimIds.map((value) => id({ value })),
		}));
	if ('verifiedFindings' in mapped)
		mapped.verifiedFindings = mapped.verifiedFindings.map((verification) => ({ ...verification, findingId: id({ value: verification.findingId }) }));
	if ('adjudicationRequests' in mapped)
		mapped.adjudicationRequests = mapped.adjudicationRequests?.map((request) => ({ ...request, findingIds: request.findingIds.map((value) => id({ value })) }));
	return mapped;
};
