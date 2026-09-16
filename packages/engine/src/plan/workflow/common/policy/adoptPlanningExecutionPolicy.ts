import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { PlanningStandardsBundle, PlanningVocabulary } from '#src/contracts/index.ts';
import { archivePlanningBrainstorm } from '#src/plan/workflow/brainstorm/index.ts';
import { readPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/readPlanningExecutionPolicy.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';
import { commitPlanningSnapshot, readPlanningSnapshot, recoverImportedPlanningAttempts } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
}

/** Adopt only at stopped entry, fencing expired work before a CAS publishes policy and standards together. */
export const adoptPlanningExecutionPolicy = async ({ runtime, snapshot: initial }: Params): Promise<PlanningSnapshot> => {
	const initialReference = readPlanningExecutionPolicy({ snapshot: initial, stage: runtime.stage })?.reference;
	initial = (await recoverImportedPlanningAttempts({ cwd: runtime.cwd, name: runtime.name })) ?? initial;
	const expected = runtime.executionPolicy;
	if (!expected) {
		if (readPlanningExecutionPolicy({ snapshot: initial, stage: runtime.stage }))
			throw new Error('Planning runtime lacks the adopted execution policy; re-enter through production composition');
		return initial;
	}
	const standards = await resolvePlanningStandards({
		cwd: runtime.cwd,
		config: runtime.config,
		role: PlanningVocabulary.Role.Architect,
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
	});
	if (standards.policyDigest !== expected.policy.standardsPolicyDigest) throw new Error('Planning standards changed before policy adoption; re-enter planning');
	const latestEntry = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!latestEntry) throw new Error('Planning generation disappeared before policy adoption');
	let snapshot = latestEntry;
	for (;;) {
		const current = readPlanningExecutionPolicy({ snapshot, stage: runtime.stage });
		if (canonicalJson({ value: current?.reference }) === canonicalJson({ value: expected.reference })) return snapshot;
		if (canonicalJson({ value: current?.reference }) !== canonicalJson({ value: initialReference }))
			throw new Error('A competing planning policy was adopted; re-enter planning');
		const record = structuredClone(snapshot.record);
		for (const work of record.work) {
			if (work.status !== PlanningVocabulary.WorkState.Running) continue;
			if (!work.currentAttemptId || !(await runtime.lease.fenceExpired({ attemptId: work.currentAttemptId })))
				throw new Error('Planning policy cannot change while an attempt owns an active lease');
			work.status = PlanningVocabulary.WorkState.Pending;
			work.currentAttemptId = undefined;
			work.resultReceiptId = undefined;
		}
		const artifacts = new Map(snapshot.artifacts);
		archivePlanningBrainstorm({ snapshot, record, artifacts, stage: runtime.stage });
		record.executionPolicies = [...(record.executionPolicies ?? []).filter((item) => item.stage !== runtime.stage), expected.reference];
		attachPlanningData({ record, artifacts, path: expected.reference.artifact, value: expected.policy });
		const bundle = PlanningStandardsBundle.parse({
			format: 'planning-standards-v1',
			policyDigest: standards.policyDigest,
			observations: standards.observations,
			channels: standards.channels,
		});
		attachPlanningData({ record, artifacts, path: 'planning-standards.json', value: bundle });
		record.standards = standards.channels.map(({ text: _text, ...descriptor }) => ({ ...descriptor, artifact: 'planning-standards.json' }));
		const committed = await commitPlanningSnapshot({
			cwd: runtime.cwd,
			name: runtime.name,
			expectedRevision: snapshot.record.revision,
			parentDigest: snapshot.digest,
			record: { ...record, revision: snapshot.record.revision + 1, parentDigest: snapshot.digest },
			artifacts,
			io: runtime.storeIO,
		});
		if (committed.committed) return committed.snapshot;
		const latest = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
		if (!latest) throw new Error('Planning generation disappeared during policy adoption');
		snapshot = latest;
	}
};
