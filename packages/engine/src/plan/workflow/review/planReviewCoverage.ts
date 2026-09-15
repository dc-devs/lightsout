import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningScope, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { selectPlanningArtifacts } from '#src/plan/workflow/common/utils/selectPlanningArtifacts.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';
import { planningFindingSettlement } from '#src/plan/workflow/review/common/utils/planningFindingSettlement.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/review/common/utils/planningIntegrationBasis.ts';
import { planningReviewObligations } from '#src/plan/workflow/review/common/utils/planningReviewObligations.ts';

interface Params {
	snapshot: PlanningSnapshot;
	stage?: PlanningWork['stage'];
}

const pendingCovers = ({
	snapshot,
	role,
	stage,
	scope,
}: {
	snapshot: PlanningSnapshot;
	role: PlanningWork['role'];
	stage: PlanningWork['stage'];
	scope: PlanningScope;
}) =>
	snapshot.record.work.some((work) => {
		if (
			work.role !== role ||
			work.stage !== stage ||
			work.status === PlanningVocabulary.WorkState.Complete ||
			work.status === PlanningVocabulary.WorkState.Interrupted
		)
			return false;
		if (work.scope.kind === PlanningVocabulary.Scope.WholePlan) return true;
		if (scope.kind === PlanningVocabulary.Scope.WholePlan) return false;
		const claims = new Set(selectPlanningClaims({ record: snapshot.record, work }).map((claim) => claim.id));
		return scope.claimIds.every((id) => claims.has(id)) && scope.phaseIds.every((id) => work.scope.phaseIds.includes(id));
	});

const coherentScope = ({ snapshot, paths, claimIds }: { snapshot: PlanningSnapshot; paths: string[]; claimIds: string[] }): PlanningScope => {
	const record = snapshot.record;
	const first = record.artifacts.find((artifact) => paths.includes(artifact.path));
	if (!first?.phaseId) return { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
	const phaseIds = new Set([first.phaseId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const artifact of record.artifacts) {
			if (!artifact.phaseId || phaseIds.has(artifact.phaseId)) continue;
			const connected =
				artifact.prerequisiteIds.some((id) => phaseIds.has(id)) ||
				record.artifacts.some((other) => other.phaseId && phaseIds.has(other.phaseId) && other.prerequisiteIds.includes(artifact.phaseId ?? '')) ||
				record.claims.some(
					(claim) =>
						claim.kind === PlanningVocabulary.ClaimKind.Contract &&
						(claim.scope.kind === PlanningVocabulary.Scope.WholePlan ||
							(claim.scope.phaseIds.includes(artifact.phaseId ?? '') && claim.scope.phaseIds.some((id) => phaseIds.has(id)))),
				);
			if (connected) {
				phaseIds.add(artifact.phaseId);
				changed = true;
			}
		}
	}
	const covered = new Set(record.artifacts.filter((artifact) => artifact.phaseId && phaseIds.has(artifact.phaseId)).flatMap((artifact) => artifact.claimIds));
	if (claimIds.some((id) => !covered.has(id))) return { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
	return { kind: PlanningVocabulary.Scope.Selected, phaseIds: [...phaseIds].sort(), claimIds, packageRoots: [] };
};

const addCoverage = ({
	snapshot,
	stage,
	sourceDigests,
	work,
	role,
	scope,
	purpose,
}: {
	snapshot: PlanningSnapshot;
	stage: PlanningWork['stage'];
	sourceDigests: string[];
	work: PlanningWork[];
	role: PlanningWork['role'];
	scope: PlanningScope;
	purpose: string;
}) => {
	const record = snapshot.record;
	if (pendingCovers({ snapshot: { ...snapshot, record: { ...record, work: [...record.work, ...work] } }, role, stage, scope })) return;
	const claims = selectPlanningClaims({ record, work: { scope } });
	const artifacts = selectPlanningArtifacts({ record, scope, claimIds: claims.map((claim) => claim.id) }).filter(
		(artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data,
	);
	const assignment =
		role === PlanningVocabulary.Role.Repair
			? purpose
			: `${purpose} Pressure-test concurrency, failures, ordering, compatibility, standards, cross-phase interfaces and exact acceptance cases. Read the complete assigned original wording and rejected alternatives; discover omitted obligations beyond the inventory. Return coverage.claimIds, phaseIds, sourceDigests and artifactPaths for what this invocation actually inspected, with an adequacy explanation. Assigned obligations: ${canonicalJson({ value: { claims: claims.map((claim) => claim.id), artifacts: artifacts.map((artifact) => artifact.path), sourceDigests } })}`;
	const inputDigest = sha256({
		content: canonicalJson({
			value: {
				role,
				stage,
				scope,
				assignment,
				semantic: planningIntegrationBasis({ snapshot }),
				priorResults: record.reviewReceipts.filter((receipt) => receipt.role === role).map((receipt) => receipt.id),
			},
		}),
	});
	const id = `coverage:${role}:${inputDigest}`;
	if (record.work.some((item) => item.id === id)) return;
	work.push({
		id,
		role,
		stage,
		scope,
		assignment,
		inputDigest,
		prerequisiteIds: [],
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
	});
};

/** Schedule coherent missing semantic coverage directly; counts and legacy grades never exempt an obligation. */
export const planReviewCoverage = ({
	snapshot,
	stage = snapshot.record.work.at(-1)?.stage ?? PlanningVocabulary.Stage.Implementation,
}: Params): PlanningWork[] => {
	const record = snapshot.record;
	if (
		!record.work.some(
			(work) => work.stage === stage && work.role === PlanningVocabulary.Role.Architect && work.status === PlanningVocabulary.WorkState.Complete,
		)
	)
		return [];
	const obligations = planningReviewObligations({ snapshot, stage });
	const whole: PlanningScope = { kind: PlanningVocabulary.Scope.WholePlan, phaseIds: [], claimIds: [], packageRoots: [] };
	let work: PlanningWork[] = [];
	const context = { snapshot, stage, sourceDigests: obligations.sourceDigests, work };
	if (!obligations.fullSources)
		addCoverage({
			...context,
			role: PlanningVocabulary.Role.DesignReview,
			scope: whole,
			purpose: 'Independently challenge the complete current original design before detailed authoring.',
		});
	const open = record.findings.filter(
		(finding) =>
			finding.severity === PlanningVocabulary.Severity.Blocking &&
			finding.owner !== PlanningVocabulary.Owner.User &&
			finding.state === PlanningVocabulary.FindingState.Open &&
			!record.work.some((work) => work.failureIds.includes(finding.id)),
	);
	const resolving = record.work.some(
		(item) =>
			item.stage === stage &&
			item.status !== PlanningVocabulary.WorkState.Complete &&
			(item.role === PlanningVocabulary.Role.Repair || item.role === PlanningVocabulary.Role.Adjudicate),
	);
	if (open.length > 0 && !resolving)
		addCoverage({
			...context,
			role: PlanningVocabulary.Role.Repair,
			scope: whole,
			purpose: `Repair these reopened concrete obligations without changing approved intent: ${open.map((finding) => finding.id).join(', ')}. Preserve their distinct observations and supply concrete resolutions; subsequent independent review must verify closure.`,
		});
	if (stage === PlanningVocabulary.Stage.Brainstorm) {
		if (obligations.uncoveredClaimIds.length > 0)
			addCoverage({ ...context, role: PlanningVocabulary.Role.DesignReview, scope: whole, purpose: 'Close the remaining product-design coverage gaps.' });
		work = work.filter((item, index) => work.findIndex((other) => other.id === item.id) === index);
	} else if (
		record.work.some((item) => item.stage === stage && item.role === PlanningVocabulary.Role.Draft && item.status === PlanningVocabulary.WorkState.Complete)
	) {
		if (obligations.uncoveredClaimIds.length + obligations.uncoveredPaths.length > 0)
			addCoverage({
				...context,
				role: PlanningVocabulary.Role.ImplementationReview,
				scope: coherentScope({ snapshot, paths: obligations.uncoveredPaths, claimIds: obligations.uncoveredClaimIds }),
				purpose: 'Grill the concrete implementation of the uncovered connected obligations.',
			});
		const closed = record.findings.every(
			(finding) => finding.severity !== PlanningVocabulary.Severity.Blocking || planningFindingSettlement({ snapshot, finding, reviews: obligations.receipts }),
		);
		if (work.length === 0 && closed && obligations.uncoveredClaimIds.length + obligations.uncoveredPaths.length === 0 && !obligations.integration)
			addCoverage({
				...context,
				role: PlanningVocabulary.Role.IntegrationReview,
				scope: whole,
				purpose: 'Independently integrate the complete original intent, concrete interfaces and current detailed review proofs.',
			});
	}
	return work;
};
