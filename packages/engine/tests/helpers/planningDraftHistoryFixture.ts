import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningFinding, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import {
	applyPlanningResult,
	claimPlanningAttempt,
	commitPlanningSnapshot,
	invokePlanningRole,
	readPlanningSnapshot,
	renderPlanningSections,
} from '#src/plan/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';

/** Accepted author, repair and independent reviewer invocations establish actual history before a stable phase split. */
export const planningDraftHistoryFixture = async () => {
	const fixture = await planningDraftFixture({ repair: true });
	const splitDriver = fixture.runtime.driver;
	fixture.runtime.services.render = renderPlanningSections;
	const current = async () => {
		const snapshot = await readPlanningSnapshot(fixture);
		if (!snapshot) throw new Error('History fixture lost its canonical generation');
		return snapshot;
	};
	const run = async ({
		id,
		role,
		phaseId,
		action,
	}: {
		id: string;
		role: PlanningWork['role'];
		phaseId: string;
		action: 'author' | 'find' | 'repair' | 'verify' | 'review';
	}) => {
		const before = await current();
		const scope = { kind: PlanningVocabulary.Scope.Selected, phaseIds: [phaseId], claimIds: [], packageRoots: [] };
		const pending: PlanningWork = {
			id,
			role,
			stage: fixture.runtime.stage,
			scope,
			prerequisiteIds: [],
			inputDigest: sha256({ content: id }),
			status: PlanningVocabulary.WorkState.Pending,
			attemptSequence: 0,
			failureIds: [],
			diagnosisIds: [],
			assignment: `${action} the ${phaseId} contract`,
		};
		const record = { ...before.record, revision: before.record.revision + 1, parentDigest: before.digest, work: [...before.record.work, pending] };
		const saved = await commitPlanningSnapshot({
			...fixture,
			record,
			artifacts: before.artifacts,
			expectedRevision: before.record.revision,
			parentDigest: before.digest,
		});
		if (!saved.committed) throw new Error('History work creation lost its transaction');
		fixture.runtime.driver = {
			name: splitDriver.name,
			invoke: async (invocation) => {
				fixture.calls.push(invocation);
				const snapshot = await current();
				const identity = JSON.parse(invocation.prompt).identity;
				const descriptor = snapshot.record.artifacts.find((item) => item.phaseId === phaseId);
				if (!descriptor) throw new Error('Historical phase disappeared');
				const content = snapshot.artifacts.get(descriptor.path);
				if (content === undefined) throw new Error('Historical phase bytes disappeared');
				if (!content.includes('\n## Context\n')) throw new Error('History fixture requires an explicit narrative Context section');
				const citation = { artifact: descriptor.path, sha256: descriptor.sha256, quote: content.split('\n')[0] };
				const finding = snapshot.record.findings.find((item) => item.scenario === 'Retry needs an explicit ordering statement');
				let proposal: object;
				if (role === PlanningVocabulary.Role.Repair)
					proposal = {
						claims: [],
						artifactEdits: [
							{
								path: descriptor.path,
								baseHash: descriptor.sha256,
								content: content.replace(
									'\n## Context\n',
									`\n## Context\n\n${action === 'repair' ? 'Read completed state before retrying.' : 'Preserve the original contract.'}\n`,
								),
							},
						],
						resolutions:
							action === 'repair' && finding
								? [{ findingId: finding.id, claimIds: [], artifacts: [descriptor.path], explanation: 'The ordering invariant is explicitly stated.' }]
								: [],
					};
				else {
					const discovered: PlanningFinding = {
						id: 'ordering-finding',
						observationIds: ['ordering-observation'],
						scope,
						scenario: 'Retry needs an explicit ordering statement',
						consequence: 'Retry could overwrite completion.',
						missingObligation: 'Read completed state first.',
						severity: PlanningVocabulary.Severity.Blocking,
						owner: PlanningVocabulary.Owner.Planner,
						state: PlanningVocabulary.FindingState.Open,
						resolutionClaimIds: [],
						resolutionArtifacts: [],
						verificationReceiptIds: [],
						citations: [citation],
					};
					proposal = {
						findings: action === 'find' ? [discovered] : [],
						coverage: {
							claimIds: [],
							phaseIds: [phaseId],
							adequacy: `Inspected the complete ${phaseId} contract and retry ordering.`,
							outcome: PlanningVocabulary.Review.Adequate,
						},
						verifiedFindings: action === 'verify' && finding ? [{ findingId: finding.id, citations: [citation] }] : [],
					};
				}
				return { exitCode: 0, text: JSON.stringify({ ...identity, kind: 'terminal', dependencies: [], ...proposal }) };
			},
		};
		const claim = await claimPlanningAttempt({ runtime: fixture.runtime, workId: pending.id, expectedInputDigest: pending.inputDigest });
		if (!claim.claimed) throw new Error('History invocation could not be claimed');
		const work = claim.snapshot.record.work.find((item) => item.id === pending.id);
		if (!work) throw new Error('History invocation work disappeared');
		const result = await invokePlanningRole({ runtime: fixture.runtime, snapshot: claim.snapshot, work });
		const accepted = await applyPlanningResult({ runtime: fixture.runtime, result });
		if (!accepted.accepted) throw new Error(`History invocation was rejected: ${accepted.reason}`);
		return accepted.snapshot;
	};
	await run({ id: 'author-a', role: PlanningVocabulary.Role.Repair, phaseId: 'A', action: 'author' });
	await run({ id: 'author-c', role: PlanningVocabulary.Role.Repair, phaseId: 'C', action: 'author' });
	await run({ id: 'challenge-a', role: PlanningVocabulary.Role.ImplementationReview, phaseId: 'A', action: 'find' });
	await run({ id: 'repair-a', role: PlanningVocabulary.Role.Repair, phaseId: 'A', action: 'repair' });
	await run({ id: 'verify-a', role: PlanningVocabulary.Role.ImplementationReview, phaseId: 'A', action: 'verify' });
	const snapshot = await run({ id: 'review-c', role: PlanningVocabulary.Role.ImplementationReview, phaseId: 'C', action: 'review' });
	const finding = snapshot.record.findings.find((item) => item.scenario === 'Retry needs an explicit ordering statement');
	if (finding?.state !== PlanningVocabulary.FindingState.Verified) throw new Error('History fixture requires an actually verified repair');
	fixture.runtime.driver = splitDriver;
	return { ...fixture, snapshot, finding };
};
