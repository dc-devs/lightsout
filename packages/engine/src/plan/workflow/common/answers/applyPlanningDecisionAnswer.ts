import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningAnswer, type PlanningRecord, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/index.ts';

interface Params {
	record: PlanningRecord;
	artifacts: Map<string, string>;
	answer: PlanningAnswer;
	text: string;
	fallbackScope?: PlanningScope;
}

/** Capture a real user revision as original wording; workflow-only approvals never enter this path. */
export const applyPlanningDecisionAnswer = ({ record, artifacts, answer, text, fallbackScope }: Params): void => {
	const old = record.claims.find((claim) => claim.id === answer.questionId);
	const finding = record.findings.find((item) => item.id === answer.questionId);
	const scope = old?.scope ?? finding?.scope ?? fallbackScope;
	if (!scope) throw new Error('The answered obligation no longer exists');
	const origin = {
		artifact: `foreground/${answer.confirmation.id}.txt`,
		locator: answer.confirmation.messageId,
		text,
		sha256: answer.confirmation.approvedDigest,
	};
	const id = `answer:${sha256({ content: canonicalJson({ value: answer }) })}`;
	record.sources.push(origin);
	record.confirmations.push(answer.confirmation);
	record.claims.push({
		id,
		kind: PlanningVocabulary.ClaimKind.Decision,
		text,
		explanation: `Foreground answer to ${answer.questionId}`,
		origin,
		owner: PlanningVocabulary.Owner.User,
		state: PlanningVocabulary.ClaimState.Settled,
		contentRevision: 1,
		dependencies: old?.dependencies ?? [],
		scope,
		confirmationId: answer.confirmation.id,
		...(old ? { supersedes: old.id } : {}),
	});
	if (old)
		for (const dependent of record.claims) {
			dependent.dependencies = dependent.dependencies.map((dependency) => (dependency === old.id ? id : dependency));
		}
	if (old) {
		old.state = PlanningVocabulary.ClaimState.Superseded;
		if (old.kind === PlanningVocabulary.ClaimKind.Question) old.question.answerId = id;
	}
	if (finding) {
		finding.owner = PlanningVocabulary.Owner.Planner;
		finding.proposedResolution = text;
	}
	const path = `planning-originals/${origin.sha256}.txt`;
	artifacts.set(path, text);
	if (!record.artifacts.some((artifact) => artifact.path === path)) record.artifacts.push(planningDataArtifact({ path, content: text }));
};
