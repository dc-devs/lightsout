import { basename } from 'node:path';
import type { DecisionsRecord, StructuralFinding } from '#src/contracts/index.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { buildPlanSyncDecisionsCommand } from '#src/plan/decisionLog/index.ts';
import { checkDecisionLog } from '#src/plan/lint/checkDecisionLog.ts';
import { isPhasedDeliverable } from '#src/plan/lint/common/utils/isPhasedDeliverable.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** The overview's text when the deliverable has one. */
	overviewText?: string;
	/** The deliverable's implementable files, each carrying the text the pass already read. */
	files: DeliverableFile[];
	/** The merged decision record every one of those files is judged against. */
	decisions: DecisionsRecord;
}

/**
 * Every plan file of one deliverable whose `## Decision Log` disagrees with the
 * saved record — the currency check for a pass that runs no structural lint of
 * its own.
 *
 * Whether the deliverable is phased comes from `isPhasedDeliverable`, the same
 * rule `lintPlanStructure` decides it by, so a phase file is asked for the same
 * section here as there. The texts come off the resolved deliverable rather than
 * off disk, which has already read every one of them.
 */
export const checkDeliverableDecisionLogs = ({ cwd, name, overviewText, files, decisions }: Params): StructuralFinding[] => {
	const syncCommand = buildPlanSyncDecisionsCommand({ cwd, name }).command;
	const phased = isPhasedDeliverable({ hasOverview: overviewText !== undefined, implementableCount: files.length });
	const texts = [
		...(overviewText === undefined ? [] : [{ base: 'overview.md', text: overviewText }]),
		...files.map((file) => ({ base: basename(file.path), text: file.text })),
	];

	return texts.flatMap(({ base, text }) => checkDecisionLog({ plan: parsePlan({ content: text, base }), phase: base, decisions, phased, syncCommand }));
};
