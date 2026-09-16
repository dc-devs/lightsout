import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningDependency, PlanningVocabulary } from '#src/contracts/index.ts';
import { fingerprintUnknownPlanningReach } from '#src/plan/workflow/common/evidence/fingerprintUnknownPlanningReach.ts';
import { hasPlanningUncertainty } from '#src/plan/workflow/common/evidence/hasPlanningUncertainty.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/invocation/PlanningBaseline.ts';
import { PlanningInvocation } from '#src/plan/workflow/common/types/invocation/PlanningInvocation.ts';
import type { PlanningAssuranceContext } from '#src/plan/workflow/common/types/PlanningAssuranceContext.ts';
import { PlanningAssuranceResult } from '#src/plan/workflow/common/types/PlanningAssuranceResult.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';

interface Params {
	runtime: PlanningRuntime;
	cycleId: string;
	snapshot?: PlanningSnapshot;
	inspectOnly?: boolean;
	dependencies?: PlanningDependency[];
}

const collectUnknownDependencies = async ({
	runtime,
	current,
	inspectOnly,
	dependencies,
}: Pick<Params, 'runtime'> & { current: PlanningSnapshot; inspectOnly: boolean; dependencies: PlanningDependency[] }) => {
	const unknown = new Map<string, Extract<PlanningDependency, { kind: typeof PlanningVocabulary.Dependency.Unknown }>>();
	const candidates: PlanningDependency[] = [...dependencies];
	if (!inspectOnly) candidates.push(...current.record.evidence.filter((evidence) => evidence.complete).flatMap((evidence) => evidence.dependencies));
	for (const [path, text] of current.artifacts) {
		if (inspectOnly) break;
		if (!path.startsWith('planning-baselines/')) continue;
		const baseline = PlanningBaseline.parse(JSON.parse(text));
		if (
			!current.record.work.some(
				(work) =>
					work.id === baseline.workId &&
					work.resultReceiptId === baseline.resultReceiptId &&
					work.status === PlanningVocabulary.WorkState.Complete &&
					work.stage === runtime.stage,
			)
		)
			continue;
		candidates.push(...baseline.dependencies);
	}
	for (const dependency of candidates) {
		if (dependency.kind !== PlanningVocabulary.Dependency.Unknown) continue;
		const policy = dependency.policy ?? planningEvidencePolicy({ exclude: [] });
		const { fallbackFingerprint: _fingerprint, ...definition } = { ...dependency, policy };
		const prior = unknown.get(dependency.id);
		if (prior) {
			const { fallbackFingerprint: _priorFingerprint, ...previous } = prior;
			if (canonicalJson({ value: previous }) !== canonicalJson({ value: definition })) throw new Error('Conflicting unknown dependency definitions');
			continue;
		}
		unknown.set(dependency.id, {
			...definition,
			fallbackFingerprint: await fingerprintUnknownPlanningReach({ cwd: runtime.cwd, roots: dependency.roots, policy }),
		});
	}
	return unknown;
};

const assessmentBasis = ({
	runtime,
	current,
	unknown,
}: Pick<Params, 'runtime'> & { current: PlanningSnapshot; unknown: Awaited<ReturnType<typeof collectUnknownDependencies>> }): string => {
	const basis = sha256({
		content: canonicalJson({
			value: {
				stage: runtime.stage,
				sources: current.record.sources,
				claims: current.record.claims,
				evidence: current.record.evidence.filter((item) => item.conclusion !== '' || hasPlanningUncertainty({ evidence: item })),
				artifacts: current.record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data),
				standards: current.record.standards,
				findings: current.record.findings.map(({ verificationReceiptIds: _receipts, state, ...finding }) => ({
					...finding,
					state: state === PlanningVocabulary.FindingState.Verified ? PlanningVocabulary.FindingState.Repairing : state,
				})),
				unknown: [...unknown.values()].sort((left, right) => left.id.localeCompare(right.id)),
			},
		}),
	});
	return basis;
};

const currentAssurance = ({ current, basis, cycleId }: { current: PlanningSnapshot; basis: string; cycleId: string }) => {
	const reviews = getCurrentPlanningReviews({ snapshot: current });
	for (const [path] of current.artifacts) {
		if (!path.startsWith('planning-assurances/')) continue;
		const report = readPlanningProof({ snapshot: current, path, schema: PlanningAssuranceResult });
		if (!report) continue;
		if (report.basis !== basis || report.cycleId !== cycleId) continue;
		const receipt = reviews.find(
			(receipt) =>
				receipt.workId === report.workId && receipt.attemptId === report.attemptId && receipt.coverage.outcome === PlanningVocabulary.Review.Adequate,
		);
		if (!receipt) continue;
		const invocation = readPlanningProof({
			snapshot: current,
			path: `planning-invocations/${sha256({ content: receipt.issuer.invocationId })}.json`,
			schema: PlanningInvocation,
		});
		if (invocation?.assuranceBasis !== basis) continue;
		return report;
	}
	return undefined;
};

/** Schedule fresh broad review for unknown reach once per current assurance cycle and semantic basis. */
export const refreshPlanningAssurance = async ({
	runtime,
	cycleId,
	snapshot: supplied,
	inspectOnly = false,
	dependencies = [],
}: Params): Promise<{ snapshot: PlanningSnapshot; assurance: PlanningAssuranceContext }> => {
	const assurance: PlanningAssuranceContext = { cycleId, unknownDependencyIds: [], pendingWorkIds: [], blockedReasons: [] };
	const snapshot = await updatePlanningSnapshot({
		runtime,
		snapshot: supplied,
		propose: async (current) => {
			assurance.pendingWorkIds = [];
			assurance.blockedReasons = [];
			const unknown = await collectUnknownDependencies({ runtime, current, inspectOnly, dependencies });
			assurance.unknownDependencyIds = [...unknown.keys()].sort();
			if (unknown.size === 0) return undefined;
			if (
				current.record.work.some(
					(work) =>
						work.stage === runtime.stage &&
						(work.role === PlanningVocabulary.Role.Architect || work.id === 'initial:design-review') &&
						work.status !== PlanningVocabulary.WorkState.Complete,
				)
			)
				return undefined;
			const basis = assessmentBasis({ runtime, current, unknown });
			assurance.basis = basis;
			if (inspectOnly) return undefined;
			const existingReport = currentAssurance({ current, basis, cycleId });
			if (existingReport) {
				assurance.blockedReasons = existingReport.blockedReasons;
				return undefined;
			}
			const key = sha256({ content: `${cycleId}:${basis}` });
			const workId = `assurance:${key}`;
			const existing = current.record.work.find((work) => work.id === workId);
			const active = current.record.work.filter(
				(work) => work.stage === runtime.stage && work.id.startsWith('assurance:') && work.status !== PlanningVocabulary.WorkState.Complete,
			);
			if (active.length > 0) {
				assurance.pendingWorkIds = active.map((work) => work.id);
				return undefined;
			}
			assurance.pendingWorkIds.push(workId);
			if (existing) return undefined;
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			const role =
				runtime.stage === PlanningVocabulary.Stage.Brainstorm
					? PlanningVocabulary.Role.DesignReview
					: record.work.some((work) => work.role === PlanningVocabulary.Role.Draft && work.status === PlanningVocabulary.WorkState.Complete)
						? PlanningVocabulary.Role.ImplementationReview
						: PlanningVocabulary.Role.DesignReview;
			record.work.push({
				id: workId,
				role,
				stage: runtime.stage,
				scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
				prerequisiteIds: [],
				inputDigest: basis,
				assignment: `Fresh independent unknown-reach assessment. Assess every dependency ${canonicalJson({ value: [...unknown.values()] })}. Inspect recorded omissions and binding obligations. Return unknownAssessments: required-unavailable with concrete paths; required-acquired with newly acquired evidence; or not-required with observable citations and an obligation-specific explanation. Do not claim hidden bytes were read or certify exhaustive absence over omitted reach.`,
				status: PlanningVocabulary.WorkState.Pending,
				attemptSequence: 0,
				failureIds: [],
				diagnosisIds: [],
			});
			attachPlanningData({
				record,
				artifacts,
				path: `planning-assurance-obligations/${key}.json`,
				value: { cycleId, workId, basis, dependencyIds: assurance.unknownDependencyIds },
			});
			return { record, artifacts };
		},
	});
	return { snapshot, assurance };
};
