import { type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { confirmCitation } from '#src/plan/common/memory/confirmCitation.ts';
import { recheckPlanText } from '#src/plan/common/memory/recheckPlanText.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';

interface Params {
	cwd: string;
	/** Every plan file with its current text — the record's phase is looked up here. */
	files: DeliverableFile[];
	overviewText?: string;
	memory: GradeMemory;
	/** The pass timestamp written into each `reopened` entry. */
	at: string;
}

/** The record as a lost citation leaves it: unanswered again, saying which claim the plan stopped supporting. */
const reopen = ({ record, citation, at }: { record: GradeFindingRecord; citation: string; at: string }): GradeFindingRecord => {
	const entry = { at, reason: `resolution citation no longer found in the plan: ${citation}`, priorStatus: GradeFindingStatus.Resolved };

	return { ...record, status: GradeFindingStatus.Open, resolution: undefined, lastSeen: at, reopened: [...record.reopened, entry] };
};

/**
 * Re-run the deterministic citation check on every `resolved` record, against
 * the plan as it reads now.
 *
 * A resolution is a claim about the plan's text. Once the text no longer says
 * it — an edit deleted the Decision Log row, a repair moved the file the
 * citation named — the question is unanswered again and must stop reading as
 * settled. It costs no agent, so it runs on every semantic pass and runs before
 * the re-verification judges are chosen, which is what lets the same pass re-ask
 * a record it just reopened and surface it if the answer really is gone.
 *
 * A `noted` record carries no verified citation, so a citation the plan no
 * longer holds says nothing about it; its own reopen path is a judge matching a
 * fresh finding to it.
 */
export const revalidateResolutions = async ({ cwd, files, overviewText, memory, at }: Params): Promise<{ memory: GradeMemory; reopened: string[] }> => {
	const findings: GradeFindingRecord[] = [];
	const reopened: string[] = [];

	for (const record of memory.findings) {
		const citation = record.status === GradeFindingStatus.Resolved ? record.resolution?.answerAt : undefined;
		const planText = recheckPlanText({ files, overviewText, phase: record.phase });
		const confirmed = citation === undefined ? undefined : await confirmCitation({ cwd, citation, planText });

		if (citation === undefined || confirmed?.ok === true) {
			findings.push(record);
			continue;
		}

		reopened.push(record.id);
		findings.push(reopen({ record, citation, at }));
	}

	return { memory: { ...memory, findings }, reopened };
};
