import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRecord, type PlanningRoleResult, type PlanningScope, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import {
	applyPlanningResult,
	claimPlanningAttempt,
	commitPlanningSnapshot,
	invokePlanningRole,
	type PlanningSnapshot,
	planningDataArtifact,
	readPlanningSnapshot,
} from '#src/plan/index.ts';
import { planningArchitectProposalFixture } from '#tests/helpers/planningArchitectProposalFixture.ts';

interface Options {
	role: PlanningWork['role'];
	scope?: PlanningScope;
	evidenceRequests?: Parameters<typeof invokePlanningRole>[0]['evidenceRequests'];
	arrange?: (params: { record: PlanningRecord; artifacts: Map<string, string>; work: PlanningWork }) => void;
	respond?: (params: { response: PlanningRoleResult; snapshot: PlanningSnapshot }) => PlanningRoleResult;
}

/** A real accepted architecture followed by one canonically claimed role; only its semantic Driver response is controlled. */
export const planningRoleProposalFixture = async ({ role, scope, arrange, respond, evidenceRequests }: Options) => {
	const id = `test:${role}`;
	const fixture = await planningArchitectProposalFixture({
		respond: async ({ response, snapshot }) => (response.workId === id && respond ? respond({ response, snapshot }) : response),
	});
	const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	if (!accepted.accepted) throw new Error('Fixture architecture was rejected');
	const record = structuredClone(accepted.snapshot.record);
	const artifacts = new Map(accepted.snapshot.artifacts);
	for (const source of record.sources) {
		const path = `planning-originals/${source.sha256}.txt`;
		if (!artifacts.has(path)) {
			artifacts.set(path, source.text);
			record.artifacts.push(planningDataArtifact({ path, content: source.text }));
		}
	}
	const work: PlanningWork = {
		id,
		role,
		stage: fixture.runtime.stage,
		scope: scope ?? fixture.scope,
		prerequisiteIds: [fixture.work.id],
		inputDigest: sha256({ content: canonicalJson({ value: { role, scope } }) }),
		assignment: 'Exercise the assigned original contract and report concrete findings.',
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
	};
	record.work.push(work);
	arrange?.({ record, artifacts, work });
	record.revision++;
	record.parentDigest = accepted.snapshot.digest;
	const committed = await commitPlanningSnapshot({
		...fixture,
		record,
		artifacts,
		expectedRevision: accepted.snapshot.record.revision,
		parentDigest: accepted.snapshot.digest,
	});
	if (!committed.committed) throw new Error('Fixture role arrangement lost its transaction');
	const claimed = await claimPlanningAttempt({ runtime: fixture.runtime, workId: id, expectedInputDigest: work.inputDigest });
	if (!claimed.claimed) throw new Error('Fixture role claim was refused');
	const claimedWork = claimed.snapshot.record.work.find((item) => item.id === id);
	if (!claimedWork) throw new Error('Fixture role disappeared');
	const result = await invokePlanningRole({ runtime: fixture.runtime, snapshot: claimed.snapshot, work: claimedWork, evidenceRequests });
	const before = await readPlanningSnapshot(fixture);
	if (!before || result.kind !== PlanningVocabulary.ResultKind.Terminal) throw new Error('Expected a recorded terminal role invocation');
	return { ...fixture, work: claimedWork, result, before };
};
