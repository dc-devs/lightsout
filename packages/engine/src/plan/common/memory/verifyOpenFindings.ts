import { basename, relative } from 'node:path';
import { buildPlanFindingRecheckInvocation } from '#src/agents/index.ts';
import {
	type Effort,
	type GapObservation,
	GapOutcome,
	GapVerdict,
	type GradeFindingRecord,
	GradeFindingStatus,
	type GradeMemory,
	type Permissions,
} from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import { confirmCitation } from '#src/plan/common/memory/confirmCitation.ts';
import { recheckPlanText } from '#src/plan/common/memory/recheckPlanText.ts';
import { recordObservations } from '#src/plan/common/memory/recordObservations.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { findingLocations } from '#src/plan/common/utils/findingLocations.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** The plan's workspace — where each judge's transcript lands, and the folder the sibling phase files sit in. */
	workspaceDir: string;
	/** Overview text for a phased plan: context the judge reads, never judged standalone. */
	overviewText?: string;
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	/** Every plan file with its current text — each of a record's locations is looked up here. */
	files: DeliverableFile[];
	memory: GradeMemory;
	/** The pass timestamp written into each of a closed record's `resolutions`. */
	at: string;
	/** Set when the caller already hit the rate-limit wall: nothing is spawned and every record stays open. */
	skipReason?: string;
}

/** One open record at one of its locations, paired with the current text of that location — the same text both the judge and the citation check read. */
interface RecheckPair {
	record: GradeFindingRecord;
	/** The plan file this spawn asks about. */
	location: string;
	/** Every plan file the record spans, in first-appearance order. */
	locations: string[];
	/** The record's observation at this location, in its own reader's words. */
	observation: GapObservation;
	planText: string;
}

/** One pair per location of an open record, each carrying the first observation made there and that location's own plan text. */
const recheckPairs = ({ record, files, overviewText }: { record: GradeFindingRecord; files: DeliverableFile[]; overviewText?: string }): RecheckPair[] => {
	const observations = recordObservations({ record });
	const locations = findingLocations({ observations, phase: record.phase });

	return locations.map((location) => ({
		record,
		location,
		locations,
		observation: observations.filter((observation) => observation.phase === location)[0],
		planText: recheckPlanText({ files, overviewText, phase: location }),
	}));
};

/** One re-verification spawn: its own runner and its own transcript, because a sink shared by a dozen judges — or by one record's several locations — interleaves into one unreadable file. */
const spawnRecheck = async ({ params, pair }: { params: Params; pair: RecheckPair }) => {
	// Ten minutes, the judges' number rather than the readers' thirty: a
	// re-verification judge that never answers leaves its record open, which
	// blocks, so its failure costs one extra question rather than a lost pass.
	const { cwd, driver, workspaceDir, overviewText, standards, model, effort, permissions, timeoutMs = 10 * 60 * 1000 } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		step: `grade-recheck-${pair.record.id}-${basename(pair.location, '.md')}`,
		model,
		effort,
		permissions,
		timeoutMs,
	});
	const outcome = await invokePlanAgent({
		invocation: buildPlanFindingRecheckInvocation({
			planText: pair.planText,
			overviewText,
			standards,
			// Only a phased plan has siblings to point at, and a record raised
			// against one phase may now be answered in another.
			planDir: overviewText === undefined ? undefined : relative(cwd, workspaceDir),
			record: pair.record,
			observation: pair.observation,
			locations: pair.locations,
		}),
		contract: GapVerdict,
	});

	return { outcome };
};

/** What one location's judge answer proves: a citation the engine confirmed against that location's own text, or the refusal that says why not. */
const checkLocation = async ({ cwd, pair, outcome }: { cwd: string; pair: RecheckPair; outcome: AgentOutcome<GapVerdict> | undefined }) => {
	const report = outcome?.ok === true ? outcome.report : undefined;
	const citation = report?.outcome === GapOutcome.AlreadyAnswered ? (report.answerAt ?? '') : undefined;
	const confirmed = citation === undefined ? undefined : await confirmCitation({ cwd, citation, planText: pair.planText });

	return {
		resolution: confirmed?.ok === true && citation !== undefined ? { phase: pair.location, answerAt: citation } : undefined,
		refusal: confirmed?.ok === false ? `${pair.location}: ${confirmed.reason}` : undefined,
	};
};

/**
 * What a record's location answers do to it: it closes only when EVERY location
 * returned `already-answered` with a citation the engine confirmed against that
 * location's own text, and its resolutions then hold one entry per location.
 * Any refusal, any failed judge and any location never asked leaves it open,
 * with each refusal on record naming the location it came from.
 */
const settleRecord = async ({
	cwd,
	record,
	located,
	at,
}: {
	cwd: string;
	record: GradeFindingRecord;
	located: Array<{ pair: RecheckPair; outcome: AgentOutcome<GapVerdict> | undefined }>;
	at: string;
}) => {
	const checks = await Promise.all(located.map(({ pair, outcome }) => checkLocation({ cwd, pair, outcome })));
	const resolutions = checks.flatMap(({ resolution }) => (resolution === undefined ? [] : [{ ...resolution, verifiedAt: at }]));
	const refusals = checks.flatMap(({ refusal }) => (refusal === undefined ? [] : [refusal]));
	const closed = resolutions.length === located.length;

	return {
		record: closed ? { ...record, status: GradeFindingStatus.Resolved, resolution: undefined, resolutions } : { ...record, resolution: undefined },
		refusal: refusals.length > 0 ? refusals.join('; ') : undefined,
	};
};

/**
 * Ask, once per location of every open record, whether the plan now states the
 * answer there.
 *
 * This is the only path that closes a record. A later reader's silence is not
 * evidence — the question it stopped reporting may simply not have come up
 * again — so an unanswered record keeps blocking until a judge points at where
 * the plan settles it AND the engine confirms that citation. A record spanning
 * several plan files is asked once per file, each judge given that file's own
 * text and that location's own wording, and it closes only when every location
 * is confirmed: fixing one occurrence never closes the others.
 *
 * Only `open` records are asked. A `pending` record needs judging rather than
 * re-verification, and a `superseded` one's question lives on its survivor.
 *
 * The text a location is asked against is its own plan file, or the whole plan
 * when it names no deliverable file — see `recheckPlanText`.
 */
export const verifyOpenFindings = async (params: Params): Promise<{ memory: GradeMemory; rateLimited: boolean; refusals: Map<string, string> }> => {
	const { cwd, files, overviewText, memory, at, skipReason } = params;
	const open = memory.findings.filter((record) => record.status === GradeFindingStatus.Open);
	// A wall met by launching another dozen spawns into it is still a wall, so a
	// skipped pass asks nothing and every record simply stays open.
	const asked = skipReason === undefined ? open : [];
	const pairs = asked.flatMap((record) => recheckPairs({ record, files, overviewText }));
	const results = await drainTasks({
		tasks: pairs.map((pair) => () => spawnRecheck({ params, pair })),
		concurrency: planAgentConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});
	const settled = new Map<string, GradeFindingRecord>();
	const refusals = new Map<string, string>();

	for (const record of asked) {
		const located = pairs.flatMap((pair, slot) => (pair.record === record ? [{ pair, outcome: results[slot]?.outcome }] : []));
		const { record: next, refusal } = await settleRecord({ cwd, record, located, at });

		settled.set(record.id, next);

		if (refusal !== undefined) {
			refusals.set(record.id, refusal);
		}
	}

	return {
		memory: { ...memory, findings: memory.findings.map((record) => settled.get(record.id) ?? record) },
		rateLimited: results.some((result) => isRateLimited({ result })),
		refusals,
	};
};
