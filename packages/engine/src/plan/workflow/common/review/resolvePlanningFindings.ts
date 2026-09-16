import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningFinding, type PlanningRoleResult, type PlanningScope, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	proposals: PlanningRoleResult;
}

const scopeFor = ({ findings, fallback }: { findings: PlanningFinding[]; fallback: PlanningScope }): PlanningScope => {
	if (findings.length === 0) return fallback;
	if (findings.some((finding) => finding.scope.kind === PlanningVocabulary.Scope.WholePlan))
		return { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
	return {
		kind: PlanningVocabulary.Scope.Selected,
		claimIds: [...new Set(findings.flatMap((finding) => finding.scope.claimIds))],
		phaseIds: [...new Set(findings.flatMap((finding) => finding.scope.phaseIds))],
		packageRoots: [...new Set(findings.flatMap((finding) => finding.scope.packageRoots))],
	};
};

const addFollowup = ({
	snapshot,
	result,
	parent,
	findings,
	work,
	role,
	assignment,
	prerequisiteIds,
	suffix,
	findingIds,
}: {
	snapshot: PlanningSnapshot;
	result: PlanningRoleResult;
	parent: PlanningWork;
	findings: PlanningFinding[];
	work: PlanningWork[];
	role: PlanningWork['role'];
	assignment: string;
	prerequisiteIds: string[];
	suffix: string;
	findingIds: string[];
}) => {
	const record = snapshot.record;
	const id = `followup:${result.attemptId}:${suffix}`;
	if (record.work.some((work) => work.id === id)) return id;
	if (findingIds.some((id) => !findings.some((finding) => finding.id === id))) throw new Error('Finding resolution references an unknown observation');
	const scope =
		role === PlanningVocabulary.Role.IntegrationReview
			? { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] }
			: scopeFor({ findings: findings.filter((finding) => findingIds.includes(finding.id)), fallback: parent.scope });
	work.push({
		id,
		role,
		stage: parent.stage,
		scope,
		prerequisiteIds,
		inputDigest: sha256({ content: canonicalJson({ value: { role, assignment, scope } }) }),
		assignment,
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
	});
	return id;
};

const reusableReviewer = ({
	snapshot,
	role,
	parent,
	repairIds,
	scope,
}: {
	snapshot: PlanningSnapshot;
	role: PlanningWork['role'];
	parent: PlanningWork;
	repairIds: string[];
	scope: PlanningScope;
}) => {
	return snapshot.record.work.some(
		(item) =>
			item.role === role &&
			item.stage === parent.stage &&
			item.status === PlanningVocabulary.WorkState.Complete &&
			snapshot.record.reviewReceipts.some(
				(receipt) => receipt.workId === item.id && receipt.attemptId === item.currentAttemptId && repairIds.every((id) => receipt.findingIds.includes(id)),
			) &&
			(item.scope.kind === PlanningVocabulary.Scope.WholePlan ||
				(scope.kind === PlanningVocabulary.Scope.Selected &&
					scope.claimIds.every((id) => item.scope.claimIds.includes(id)) &&
					scope.phaseIds.every((id) => item.scope.phaseIds.includes(id)) &&
					scope.packageRoots.every((root) =>
						item.scope.packageRoots.some((covered) => covered === '.' || covered === root || root.startsWith(`${covered}/`)),
					))),
	);
};

const repairFindingIds = ({ result, disputed }: { result: PlanningRoleResult; disputed: Set<string> }) => {
	const produced =
		'findings' in result
			? result.findings
					.filter(
						(finding) =>
							finding.owner !== PlanningVocabulary.Owner.User && finding.severity === PlanningVocabulary.Severity.Blocking && !disputed.has(finding.id),
					)
					.map((finding) => finding.id)
			: [];
	const directed =
		'dispositions' in result
			? result.dispositions
					.filter((disposition) => disposition.outcome === PlanningVocabulary.Disposition.Repair)
					.flatMap((disposition) => disposition.findingIds)
			: [];
	return [...new Set([...produced, ...directed])];
};

/** Preserve every observation; clear defects go directly to scoped repair, while only explicit disputes require adjudication. */
export const resolvePlanningFindings = ({ snapshot, proposals: result }: Params): { findings: PlanningFinding[]; work: PlanningWork[] } => {
	const record = snapshot.record;
	const parent = record.work.find((work) => work.id === result.workId);
	if (!parent) throw new Error('Finding resolution requires its actual originating assignment');
	const findings = structuredClone(record.findings);
	if ('findings' in result)
		for (const finding of result.findings) {
			const existing = findings.find((item) => item.id === finding.id);
			if (existing && canonicalJson({ value: existing }) !== canonicalJson({ value: finding }))
				throw new Error('A repeated observation cannot replace persistent finding meaning or closure');
			if (!existing) findings.push(finding);
		}
	const work: PlanningWork[] = [];
	const context = { snapshot, result, parent, findings, work };
	const disputes = 'adjudicationRequests' in result ? (result.adjudicationRequests ?? []) : [];
	const disputed = new Set(disputes.flatMap((request) => request.findingIds));
	for (const [index, request] of disputes.entries())
		addFollowup({
			...context,
			role: PlanningVocabulary.Role.Adjudicate,
			assignment: `Resolve this explicit dispute: ${canonicalJson({ value: request })}`,
			prerequisiteIds: [parent.id],
			suffix: `adjudicate:${index}`,
			findingIds: request.findingIds,
		});
	const repairIds = repairFindingIds({ result, disputed });
	if (repairIds.length > 0) {
		const repair = addFollowup({
			...context,
			role: PlanningVocabulary.Role.Repair,
			assignment: `Repair these concrete observations without changing approved intent: ${repairIds.join(', ')}`,
			prerequisiteIds: [parent.id],
			suffix: 'repair',
			findingIds: repairIds,
		});
		const role =
			parent.role === PlanningVocabulary.Role.DesignReview ||
			parent.role === PlanningVocabulary.Role.Architect ||
			parent.stage === PlanningVocabulary.Stage.Brainstorm
				? PlanningVocabulary.Role.DesignReview
				: parent.role === PlanningVocabulary.Role.IntegrationReview
					? PlanningVocabulary.Role.IntegrationReview
					: PlanningVocabulary.Role.ImplementationReview;
		const scope = scopeFor({ findings: findings.filter((finding) => repairIds.includes(finding.id)), fallback: parent.scope });
		const reusable = reusableReviewer({ snapshot, role, parent, repairIds, scope });
		if (!reusable)
			addFollowup({
				...context,
				role,
				assignment: `Independently verify the repair of ${repairIds.join(', ')} and investigate further failure scenarios.`,
				prerequisiteIds: [repair],
				suffix: 'recheck',
				findingIds: repairIds,
			});
	} else if ('coverage' in result && result.coverage.outcome === PlanningVocabulary.Review.Insufficient)
		addFollowup({
			...context,
			role: parent.role,
			assignment: `Complete missing independent review coverage: ${result.coverage.adequacy}`,
			prerequisiteIds: [parent.id],
			suffix: 'coverage',
			findingIds: [],
		});
	return { findings, work };
};
