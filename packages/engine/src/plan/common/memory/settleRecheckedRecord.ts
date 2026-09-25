import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import type { GapVerdict } from '#src/contracts/plan/grade/GapVerdict.ts';
import type { GradeFindingRecord } from '#src/contracts/plan/memory/GradeFindingRecord.ts';
import { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';
import { confirmCitation } from '#src/plan/common/memory/confirmCitation.ts';

interface Params {
	cwd: string;
	record: GradeFindingRecord;
	/** One entry per location of the record: the plan file asked about, the text the judge was given, and what came back — `undefined` when the judge never answered. */
	located: Array<{ location: string; planText: string; outcome: AgentOutcome<GapVerdict> | undefined }>;
	/** The pass timestamp written into every resolution and into the recheck stamp. */
	at: string;
}

/** What one location's judge answer proves: a citation the engine confirmed against that location's own text, or the refusal that says why not. */
const checkLocation = async ({
	cwd,
	location,
	planText,
	outcome,
}: {
	cwd: string;
	location: string;
	planText: string;
	outcome: AgentOutcome<GapVerdict> | undefined;
}) => {
	const report = outcome?.ok === true ? outcome.report : undefined;
	const citation = report?.outcome === GapOutcome.AlreadyAnswered ? (report.answerAt ?? '') : undefined;
	const confirmed = citation === undefined ? undefined : await confirmCitation({ cwd, citation, planText });

	return {
		resolution: confirmed?.ok === true && citation !== undefined ? { phase: location, answerAt: citation } : undefined,
		refusal: confirmed?.ok === false ? `${location}: ${confirmed.reason}` : undefined,
	};
};

/**
 * What a record's location answers do to it: it closes only when EVERY location
 * returned `already-answered` with a citation the engine confirmed against that
 * location's own text, and its resolutions then hold one entry per location.
 * Any refusal, any failed judge and any location never asked leaves it open,
 * with each refusal on record naming the location it came from.
 *
 * @returns the record as it now stands, and the refusals that kept it open
 */
export const settleRecheckedRecord = async ({ cwd, record, located, at }: Params): Promise<{ record: GradeFindingRecord; refusal: string | undefined }> => {
	const checks = await Promise.all(located.map(({ location, planText, outcome }) => checkLocation({ cwd, location, planText, outcome })));
	const resolutions = checks.flatMap(({ resolution }) => (resolution === undefined ? [] : [{ ...resolution, verifiedAt: at }]));
	const refusals = checks.flatMap(({ refusal }) => (refusal === undefined ? [] : [refusal]));
	const closed = resolutions.length === located.length;

	// Stamped whatever the answer was — closed, refused, or a judge that never
	// replied. The stamp says the question was ASKED, which is what stops the next
	// pass buying it again; a record nobody could ask stays unstamped and so is
	// always worth asking.
	const asked = { ...record, lastRecheckedAt: at, resolution: undefined };

	return {
		record: closed ? { ...asked, status: GradeFindingStatus.Resolved, resolutions } : asked,
		refusal: refusals.length > 0 ? refusals.join('; ') : undefined,
	};
};
