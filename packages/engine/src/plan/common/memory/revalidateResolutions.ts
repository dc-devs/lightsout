import { type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { confirmCitation } from '#src/plan/common/memory/confirmCitation.ts';
import { recheckPlanText } from '#src/plan/common/memory/recheckPlanText.ts';
import { recordResolutions } from '#src/plan/common/memory/recordResolutions.ts';
import { reopenRecord } from '#src/plan/common/memory/reopenRecord.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';

interface Params {
	cwd: string;
	/** Every plan file with its current text — each resolution's location is looked up here. */
	files: DeliverableFile[];
	overviewText?: string;
	memory: GradeMemory;
	/** The pass timestamp written into each `reopened` entry. */
	at: string;
}

/** The first of a resolved record's citations the plan no longer supports, each checked against its own location's text, or `undefined` when every one still stands. */
const firstLostCitation = async ({ params, record }: { params: Params; record: GradeFindingRecord }) => {
	const { cwd, files, overviewText } = params;
	let lost: { phase: string; answerAt: string } | undefined;

	for (const { phase, answerAt } of recordResolutions({ record })) {
		const confirmed = await confirmCitation({ cwd, citation: answerAt, planText: recheckPlanText({ files, overviewText, phase }) });

		if (!confirmed.ok) {
			lost = { phase, answerAt };
			break;
		}
	}

	return lost;
};

/**
 * Re-run the deterministic citation check on every `resolved` record, against
 * the plan as it reads now.
 *
 * A resolution is a claim about the plan's text at one location. Once the text
 * no longer says it — an edit deleted the Decision Log row, a repair moved the
 * file the citation named — the question is unanswered again and must stop
 * reading as settled. A record resolved at several locations reopens when any
 * one of them is lost, and every stored resolution goes with it: a group whose
 * repair came undone in one place is unresolved as a whole. It costs no agent,
 * so it runs on every semantic pass and runs before the re-verification judges
 * are chosen, which is what lets the same pass re-ask a record it just reopened.
 *
 * A `noted` record carries no verified citation, so a citation the plan no
 * longer holds says nothing about it; its own reopen path is a judge matching a
 * fresh finding to it.
 */
export const revalidateResolutions = async (params: Params): Promise<{ memory: GradeMemory; reopened: string[] }> => {
	const { memory, at } = params;
	const findings: GradeFindingRecord[] = [];
	const reopened: string[] = [];

	for (const record of memory.findings) {
		const lost = record.status === GradeFindingStatus.Resolved ? await firstLostCitation({ params, record }) : undefined;

		if (lost === undefined) {
			findings.push(record);
			continue;
		}

		reopened.push(record.id);
		findings.push(reopenRecord({ record, reason: `resolution citation for ${lost.phase} no longer found in the plan: ${lost.answerAt}`, at }));
	}

	return { memory: { ...memory, findings }, reopened };
};
