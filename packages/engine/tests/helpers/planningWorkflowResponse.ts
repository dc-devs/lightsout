import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import type { PlanningSnapshot } from '#src/plan/index.ts';

interface Params {
	invocation: DriverInvocation;
	snapshot: PlanningSnapshot;
}

/** Complete deterministic semantic responses; tests replace only the specific behavior they exercise. */
export const planningWorkflowResponse = ({ invocation, snapshot }: Params): PlanningRoleResult => {
	const { identity } = JSON.parse(invocation.prompt) as {
		identity: {
			role: PlanningRoleResult['role'];
			workId: string;
			attemptId: string;
			inputDigest: string;
			invocationId: string;
			packetDigest: string;
		};
	};
	const base = { ...identity, kind: PlanningVocabulary.ResultKind.Terminal, dependencies: [] };
	const record = snapshot.record;
	const scope = record.work.find((work) => work.id === identity.workId)?.scope;
	if (scope === undefined) throw new Error('Fake provider received an unclaimed work identity');
	const plan = record.artifacts.find((artifact) => artifact.path === 'plan.md');
	switch (identity.role) {
		case PlanningVocabulary.Role.Investigate:
			return { ...base, role: identity.role, claims: [], evidence: [], work: [], findings: [] };
		case PlanningVocabulary.Role.Architect: {
			const origin = record.sources[0];
			if (!origin) throw new Error('Architecture must receive its original source');
			return {
				...base,
				role: identity.role,
				claims: [
					{
						id: 'upload-architecture',
						kind: PlanningVocabulary.ClaimKind.Architecture,
						text: 'Preserve the upload service retry identity.',
						explanation: 'The approved upload behavior constrains retries.',
						contentRevision: 1,
						origin,
						owner: PlanningVocabulary.Owner.Planner,
						state: PlanningVocabulary.ClaimState.Settled,
						dependencies: ['required'],
						scope,
					},
				],
				evidence: [],
				work: [],
				findings: [],
				artifactLayouts: [
					{
						path: 'plan.md',
						variant: PlanningVocabulary.Artifact.Single,
						claimIds: ['required', 'upload-architecture'],
						prerequisiteIds: [],
						exports: [],
						boundaries: scope,
						baseDescriptorDigest: plan ? sha256({ content: canonicalJson({ value: plan }) }) : null,
					},
				],
			};
		}
		case PlanningVocabulary.Role.Draft:
			return {
				...base,
				role: identity.role,
				claims: [],
				artifactEdits: [
					{
						path: 'plan.md',
						baseHash: plan?.sha256 ?? null,
						content: '# Upload retry plan\n\nPreserve completed uploads and reuse the same idempotency key.\n',
					},
				],
			};
		case PlanningVocabulary.Role.DesignReview:
		case PlanningVocabulary.Role.ImplementationReview:
		case PlanningVocabulary.Role.IntegrationReview: {
			const content = snapshot.artifacts.get('plan.md');
			return {
				...base,
				role: identity.role,
				findings: [],
				coverage: {
					claimIds: record.claims.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded).map((claim) => claim.id),
					phaseIds: record.artifacts.flatMap((artifact) => (artifact.phaseId ? [artifact.phaseId] : [])),
					sourceDigests: [...new Set(record.sources.map((source) => source.sha256))],
					artifactPaths: record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data).map((artifact) => artifact.path),
					adequacy: 'Traced the preserved upload and retry contracts through each assigned failure path.',
					outcome: PlanningVocabulary.Review.Adequate,
				},
				verifiedFindings: record.findings
					.filter((finding) => finding.state === PlanningVocabulary.FindingState.Repairing)
					.map((finding) => {
						if (!plan || !content) throw new Error('Verification requires the actual repaired artifact');
						return { findingId: finding.id, citations: [{ artifact: 'plan.md', quote: content, sha256: plan.sha256 }] };
					}),
			};
		}
		case PlanningVocabulary.Role.Repair: {
			if (!plan) throw new Error('Repair requires an existing artifact');
			const findings = record.findings.filter(
				(finding) => finding.state === PlanningVocabulary.FindingState.Open || finding.state === PlanningVocabulary.FindingState.Repairing,
			);
			return {
				...base,
				role: identity.role,
				claims: [],
				artifactEdits: [
					{
						path: 'plan.md',
						baseHash: plan.sha256,
						content: `${snapshot.artifacts.get('plan.md')}\nResolved scenarios: ${findings.map((finding) => finding.scenario).join('; ')}\n`,
					},
				],
				resolutions: findings.map((finding) => ({
					findingId: finding.id,
					claimIds: [],
					artifacts: ['plan.md'],
					explanation: `Added the missing behavior for ${finding.scenario}`,
				})),
			};
		}
		case PlanningVocabulary.Role.Adjudicate:
			return { ...base, role: identity.role, dispositions: [] };
		case PlanningVocabulary.Role.Diagnose:
			return {
				...base,
				role: identity.role,
				work: [],
				findings: [],
				diagnosis: 'Retry the interrupted provider operation using the preserved observations and current invocation identity.',
			};
	}
};
