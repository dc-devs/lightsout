import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningAnswer, PlanningVocabulary } from '#src/contracts/index.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';

interface Params {
	checkpoint: NonNullable<WorkerOutcome['planningQuestion']>;
	text: string;
	ticketRunDir: string;
	coordinatorRunId: string;
}

/** Preserve the actual returned relay bytes before continuation; numeric text and silence never impersonate approval. */
export const recordPlanningRelayAnswer = async ({ checkpoint, text, ticketRunDir, coordinatorRunId }: Params): Promise<PlanningAnswer> => {
	if (!text.trim()) throw new Error('Planning requires an explicit nonempty relay answer');
	const id = `relay:${coordinatorRunId}:${randomUUID()}`;
	const selectedOption = checkpoint.question.options.find((option) => option.label === text)?.label;
	const answer: PlanningAnswer = {
		questionId: checkpoint.questionId,
		questionDigest: checkpoint.questionDigest,
		checkpointRevision: checkpoint.checkpointRevision,
		...(selectedOption ? { selectedOption } : { freeText: text }),
		confirmation: {
			id,
			channel: PlanningVocabulary.ConfirmationChannel.Relay,
			messageId: id,
			messageText: text,
			approvedDigest: sha256({ content: text }),
			delegation: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
		},
	};
	const folder = join(ticketRunDir, 'planning-answers');
	await mkdir(folder, { recursive: true });
	await writeFile(join(folder, `${sha256({ content: id })}.json`), canonicalJson({ value: answer }), { flag: 'wx', flush: true });
	return answer;
};
