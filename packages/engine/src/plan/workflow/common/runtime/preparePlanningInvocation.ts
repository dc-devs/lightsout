import { randomUUID } from 'node:crypto';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningEvidenceRequest, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { buildPlanningInvocationPacket } from '#src/plan/workflow/common/runtime/buildPlanningInvocationPacket.ts';
import { readPlanningInvocation } from '#src/plan/workflow/common/runtime/readPlanningInvocation.ts';
import { readPlanningObservations } from '#src/plan/workflow/common/runtime/readPlanningObservations.ts';
import { refreshPlanningAssurance } from '#src/plan/workflow/common/runtime/refreshPlanningAssurance.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { PlanningAssuranceObligation } from '#src/plan/workflow/common/types/PlanningAssuranceObligation.ts';
import type { PlanningInvocation } from '#src/plan/workflow/common/types/PlanningInvocation.ts';
import type { PlanningPacket } from '#src/plan/workflow/common/types/PlanningPacket.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { fingerprintPlanningDependencies, readPlanningEvidence } from '#src/plan/workflow/evidence/index.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	work: PlanningWork;
	standards: PlanningStandards;
	requests?: PlanningEvidenceRequest[];
}

const acquireObservations = async ({
	runtime,
	snapshot,
	work,
	standards,
	requests,
	previous,
}: Omit<Params, 'requests'> & { requests: PlanningEvidenceRequest[]; previous?: PlanningInvocation }) => {
	const paths =
		previous?.observationPaths ??
		(work.id.startsWith('assurance:')
			? [...snapshot.artifacts]
					.filter(([path]) => {
						if (!path.startsWith('planning-observations/')) return false;
						const observation = readPlanningObservations({ snapshot, paths: [path] })[0];
						if (!observation) throw new Error('Assurance observation is missing');
						return observation.evidence.dependencies.some((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown);
					})
					.map(([path]) => path)
			: []);
	const observations = readPlanningObservations({ snapshot, paths });
	const acquired = new Map<string, (typeof observations)[number]>();
	for (const observed of observations) {
		const freshness = await fingerprintPlanningDependencies({
			cwd: runtime.cwd,
			record: snapshot.record,
			standards,
			dependencies: observed.evidence.dependencies,
			policy: planningEvidencePolicy({ exclude: [] }),
		});
		if (!freshness.current && previous?.attemptId === work.currentAttemptId)
			throw new Error('Evidence changed during the same logical attempt; restart with fresh authority');
		acquired.set(
			`${observed.evidence.assignmentId}:${observed.request.requestId}`,
			freshness.current
				? observed
				: { request: observed.request, ...(await readPlanningEvidence({ runtime, assignmentId: work.id, request: observed.request })) },
		);
	}
	for (const request of requests) {
		const key = `${work.id}:${request.requestId}`;
		const existing = acquired.get(key);
		if (existing && canonicalJson({ value: existing.request }) !== canonicalJson({ value: request }))
			throw new Error('Evidence request identity cannot name different operations');
		if (!existing) acquired.set(key, { request, ...(await readPlanningEvidence({ runtime, assignmentId: work.id, request })) });
	}
	return acquired;
};

const inspectAssurance = async ({ runtime, snapshot, work, packet }: Pick<Params, 'runtime' | 'snapshot' | 'work'> & { packet: PlanningPacket }) => {
	let assuranceBasis: string | undefined;
	if (work.id.startsWith('assurance:')) {
		const content = snapshot.artifacts.get(`planning-assurance-obligations/${work.id.slice('assurance:'.length)}.json`);
		if (!content) throw new Error('Assurance invocation lacks its explicit obligation');
		const obligation = PlanningAssuranceObligation.parse(JSON.parse(content));
		const inspected = await refreshPlanningAssurance({
			runtime,
			cycleId: obligation.cycleId,
			snapshot,
			inspectOnly: true,
			dependencies: packet.dependencies,
		});
		assuranceBasis = inspected.assurance.basis;
		if (!assuranceBasis) throw new Error('Assurance invocation lacks its current assessment basis');
	}
	return assuranceBasis;
};

/** Acquire missing/stale observations once, then bind a fresh invocation through an atomic current-attempt transition. */
export const preparePlanningInvocation = async ({
	runtime,
	snapshot,
	work,
	standards,
	requests = [],
}: Params): Promise<{ snapshot: PlanningSnapshot; binding: PlanningInvocation; packet: PlanningPacket }> => {
	const previous = readPlanningInvocation({ snapshot, workId: work.id });
	if (work.role === PlanningVocabulary.Role.Investigate && !previous && runtime.services.priorArt)
		snapshot = await runtime.services.priorArt({ runtime, snapshot, work });
	const acquired = await acquireObservations({ runtime, snapshot, work, standards, requests, previous });
	if (previous && previous.attemptId === work.currentAttemptId) {
		const before = await buildPlanningInvocationPacket({ runtime, snapshot, work, standards, observationPaths: previous.observationPaths });
		if (before.inputDigest !== previous.packetDigest) throw new Error('Binding obligations changed during evidence continuation');
	}
	const id = randomUUID();
	const saved = await updatePlanningSnapshot({
		runtime,
		propose: async (current) => {
			const active = current.record.work.find((item) => item.id === work.id);
			if (
				!active?.currentAttemptId ||
				active.currentAttemptId !== work.currentAttemptId ||
				active.inputDigest !== work.inputDigest ||
				active.status !== PlanningVocabulary.WorkState.Running
			)
				throw new Error('Planning invocation lost its current attempt');
			const latest = readPlanningInvocation({ snapshot: current, workId: work.id });
			if (previous && previous.attemptId === work.currentAttemptId) {
				if (latest?.id !== previous.id) throw new Error('A newer planning invocation already owns this attempt');
				const priorPacket = await buildPlanningInvocationPacket({
					runtime,
					snapshot: current,
					work: active,
					standards,
					observationPaths: previous.observationPaths,
				});
				if (priorPacket.inputDigest !== previous.packetDigest) throw new Error('Current obligations changed during evidence continuation');
			}
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			const observationPaths: string[] = [];
			for (const value of acquired.values()) {
				const path = `planning-observations/${sha256({ content: canonicalJson({ value }) })}.json`;
				attachPlanningData({ record, artifacts, path, value });
				observationPaths.push(path);
			}
			const packet = await buildPlanningInvocationPacket({ runtime, snapshot: { ...current, record, artifacts }, work: active, standards, observationPaths });
			const assuranceBasis = await inspectAssurance({ runtime, snapshot: { ...current, record, artifacts }, work, packet });
			const binding: PlanningInvocation = {
				format: 'planning-invocation-v1',
				id,
				workId: active.id,
				attemptId: active.currentAttemptId,
				role: active.role,
				stage: active.stage,
				inputDigest: active.inputDigest,
				packetDigest: packet.inputDigest,
				invocationPolicyDigest: packet.invocationPolicyDigest,
				...(assuranceBasis ? { assuranceBasis } : {}),
				baseGeneration: current.digest,
				sequence: (readPlanningInvocation({ snapshot: current, workId: work.id })?.sequence ?? 0) + 1,
				observationPaths,
				dependencies: packet.dependencies,
			};
			attachPlanningData({ record, artifacts, path: `planning-invocations/${sha256({ content: id })}.json`, value: binding });
			return { record, artifacts };
		},
	});
	const binding = readPlanningInvocation({ snapshot: saved, workId: work.id });
	if (!binding || binding.id !== id) throw new Error('Planning invocation was replaced before dispatch');
	const packet = await buildPlanningInvocationPacket({ runtime, snapshot: saved, work, standards, observationPaths: binding.observationPaths });
	if (packet.inputDigest !== binding.packetDigest) throw new Error('Planning policy changed before dispatch');
	return { snapshot: saved, binding, packet };
};
