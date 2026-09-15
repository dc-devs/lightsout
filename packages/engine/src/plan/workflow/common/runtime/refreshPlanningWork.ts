import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningDependency, type PlanningRecord, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { hasPlanningUncertainty } from '#src/plan/workflow/common/evidence/hasPlanningUncertainty.ts';
import { normalizePlanningUnknownEvidence } from '#src/plan/workflow/common/evidence/normalizePlanningUnknownEvidence.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { planningSemanticBasis } from '#src/plan/workflow/common/runtime/planningSemanticBasis.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/PlanningBaseline.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { applyPlanningInvalidation } from '#src/plan/workflow/common/utils/applyPlanningInvalidation.ts';
import { fingerprintPlanningDependencies } from '#src/plan/workflow/evidence/index.ts';
import { planningFindingSettlement } from '#src/plan/workflow/review/index.ts';

interface Params {
	runtime: PlanningRuntime;
	standards: PlanningStandards;
	snapshot?: PlanningSnapshot;
}

/** Assign stale conclusions from retained authors to an explicit investigator; immutable prior generations retain their provenance. */
const scheduleStaleConclusions = ({ record, stage }: { record: PlanningRecord; stage: PlanningRuntime['stage'] }): void => {
	const evidence = record.evidence.filter((item) => {
		if (
			item.complete ||
			(item.conclusion === '' && !hasPlanningUncertainty({ evidence: item }) && !record.claims.some((claim) => claim.dependencies.includes(item.id)))
		)
			return false;
		const owner = record.work.find((work) => work.id === item.assignmentId);
		return owner?.status === PlanningVocabulary.WorkState.Complete && owner.role !== PlanningVocabulary.Role.Investigate;
	});
	if (evidence.length === 0) return;
	const claimIds = [
		...new Set(
			evidence.flatMap((item) => [...item.claimIds, ...record.claims.filter((claim) => claim.dependencies.includes(item.id)).map((claim) => claim.id)]),
		),
	];
	const claims = record.claims.filter((claim) => claimIds.includes(claim.id));
	const wide = claims.length === 0 || claims.some((claim) => claim.scope.kind === PlanningVocabulary.Scope.WholePlan);
	const scope: PlanningScope = wide
		? { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] }
		: {
				kind: PlanningVocabulary.Scope.Selected,
				claimIds,
				phaseIds: [...new Set(claims.flatMap((claim) => claim.scope.phaseIds))],
				packageRoots: [...new Set(claims.flatMap((claim) => claim.scope.packageRoots))],
			};
	const assignment = `Reacquire the supporting observations and replace each of these exact stale evidence IDs with a current semantic conclusion: ${canonicalJson({ value: evidence.map(({ id, acquisition, conclusion }) => ({ id, acquisition, conclusion })) })}. Preserve approved claims and retained authoring. Incomplete evidence is a question to investigate, never reusable proof. Report a concrete blocker if required information is unavailable.`;
	const inputDigest = sha256({ content: canonicalJson({ value: { stage, scope, assignment, evidence } }) });
	const id = `reinvestigate:${inputDigest}`;
	if (record.work.some((work) => work.id === id)) throw new Error('Stale evidence investigation identity already exists without ownership');
	record.work.push({
		id,
		role: PlanningVocabulary.Role.Investigate,
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
	for (const item of evidence) item.assignmentId = id;
};

/** Reuse identical IO checks only within one immutable proposal; every CAS retry and cycle gets a new map. */
const fingerprintBaseline = async ({
	runtime,
	snapshot,
	standards,
	dependencies,
	observations,
}: {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	standards: PlanningStandards;
	dependencies: PlanningDependency[];
	observations: Map<string, Awaited<ReturnType<typeof fingerprintPlanningDependencies>>>;
}) => {
	const checked = [];
	for (const dependency of dependencies) {
		const key = canonicalJson({ value: { cwd: runtime.cwd, dependency } });
		let result = observations.get(key);
		if (!result) {
			result = await fingerprintPlanningDependencies({
				cwd: runtime.cwd,
				record: snapshot.record,
				standards,
				dependencies: [dependency],
				policy: planningEvidencePolicy({ exclude: [] }),
			});
			observations.set(key, result);
		}
		checked.push(result);
	}
	return {
		current: checked.every((result) => result.current),
		changed: checked.flatMap((result) => result.changed),
		unknown: checked.some((result) => result.unknown),
		dependencies: checked.flatMap((result) => result.dependencies),
	};
};

/** Refresh observed IO and retire affected review authority without replaying completed authoring or historical adjudication. */
export const refreshPlanningWork = async ({ runtime, standards, snapshot }: Params): Promise<PlanningSnapshot> =>
	updatePlanningSnapshot({
		runtime,
		snapshot,
		propose: async (snapshot) => {
			const normalized = [];
			for (const evidence of snapshot.record.evidence) normalized.push(await normalizePlanningUnknownEvidence({ cwd: runtime.cwd, evidence }));
			snapshot = { ...snapshot, record: { ...snapshot.record, evidence: normalized } };
			const frontierPath = 'planning-dependency-frontier.json';
			const priorFrontier = z.array(PlanningDependency).parse(JSON.parse(snapshot.artifacts.get(frontierPath) ?? '[]'));
			const frontier = new Map(priorFrontier.map((dependency) => [dependency.id, dependency]));
			const changed: PlanningDependency[] = [];
			const stale = new Set<string>();
			const observations = new Map<string, Awaited<ReturnType<typeof fingerprintPlanningDependencies>>>();
			for (const [path, text] of snapshot.artifacts) {
				if (!path.startsWith('planning-baselines/')) continue;
				const baseline = PlanningBaseline.parse(JSON.parse(text));
				const work = snapshot.record.work.find((item) => item.id === baseline.workId && item.resultReceiptId === baseline.resultReceiptId);
				if (!work || work.status !== PlanningVocabulary.WorkState.Complete) continue;
				const observed = await fingerprintBaseline({
					runtime,
					snapshot,
					standards,
					dependencies: baseline.dependencies.filter((dependency) => dependency.kind !== PlanningVocabulary.Dependency.Collection),
					observations,
				});
				const currentConsumer = [
					PlanningVocabulary.Role.Investigate,
					PlanningVocabulary.Role.DesignReview,
					PlanningVocabulary.Role.ImplementationReview,
					PlanningVocabulary.Role.IntegrationReview,
				].some((role) => role === work.role);
				for (const dependency of observed.dependencies.filter((dependency) => observed.changed.includes(dependency.id))) {
					if (currentConsumer || canonicalJson({ value: frontier.get(dependency.id) }) !== canonicalJson({ value: dependency })) changed.push(dependency);
					frontier.set(dependency.id, dependency);
				}
				const review = [PlanningVocabulary.Role.DesignReview, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview].some(
					(role) => role === work.role,
				);
				const semantic = planningSemanticBasis({ record: snapshot.record, work, seed: baseline.semanticBasis });
				if (
					(review && (!observed.current || semantic.digest !== baseline.semanticBasis.digest)) ||
					(work.role === PlanningVocabulary.Role.Investigate && !observed.current)
				)
					stale.add(work.id);
			}
			const invalidation = runtime.services.invalidate({ snapshot, changedDependencies: changed, changedClaimIds: [] });
			const record = structuredClone(snapshot.record);
			const reopen = record.findings
				.filter((finding) => finding.state === PlanningVocabulary.FindingState.Withdrawn && !planningFindingSettlement({ snapshot, finding, reviews: [] }))
				.map((finding) => finding.id);
			applyPlanningInvalidation({
				record,
				invalidation: {
					...invalidation,
					workIds: [...new Set([...invalidation.workIds, ...stale])],
					reopenFindingIds: [...new Set([...(invalidation.reopenFindingIds ?? []), ...reopen])],
				},
			});
			for (const evidence of record.evidence)
				if (stale.has(evidence.assignmentId) || evidence.dependencies.some((dependency) => changed.some((item) => item.id === dependency.id)))
					evidence.complete = false;
			scheduleStaleConclusions({ record, stage: runtime.stage });
			const candidate = { ...snapshot, record };
			const additional = runtime.services.coverage?.({ snapshot: candidate, stage: runtime.stage }) ?? [];
			applyPlanningInvalidation({
				record,
				invalidation: {
					workIds: [],
					receiptIds: [],
					reason: 'Current uncovered obligations',
					work: additional.filter((work) => !record.work.some((existing) => existing.id === work.id)),
				},
			});
			const artifacts = new Map(snapshot.artifacts);
			if (frontier.size > 0)
				attachPlanningData({ record, artifacts, path: frontierPath, value: [...frontier.values()].sort((a, b) => a.id.localeCompare(b.id)) });
			return { record, artifacts };
		},
	});
