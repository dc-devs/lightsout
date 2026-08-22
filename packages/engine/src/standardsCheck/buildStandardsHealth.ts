import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type AdvisoryOutcome, AdvisoryResponse, BatchOutcome, BatchReport, RefactorWorklist, type StandardsFinding } from '#src/contracts/index.ts';
import { listRunIds, readRunManifest } from '#src/runState/index.ts';
import type { StandardsHealth } from '#src/standardsCheck/common/types/StandardsHealth.ts';
import type { StandardsHealthRule } from '#src/standardsCheck/common/types/StandardsHealthRule.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';

/** The running counts for one rule: every field of its report row except the ones the rule itself supplies. */
type Tally = Omit<StandardsHealthRule, 'id' | 'set' | 'documentPath' | 'checked'>;

const emptyTally = (): Tally => ({
	attempted: 0,
	resolved: 0,
	declined: 0,
	untracked: 0,
	adviceApplied: 0,
	adviceDeclined: 0,
	adviceAlreadyMet: 0,
	reasons: [],
});

const tallyFor = ({ tallies, rule }: { tallies: Map<string, Tally>; rule: string }) => {
	const existing = tallies.get(rule);

	if (existing) {
		return existing;
	}

	const created = emptyTally();

	tallies.set(rule, created);

	return created;
};

/**
 * One refactor run's recorded evidence: the work-list frozen at its start and
 * the step records that answered it. Anything else — an implement run, a
 * manifest that will not parse, a work-list that has been deleted — is not this
 * report's material.
 */
const readRefactorRun = async ({ cwd, runId }: { cwd: string; runId: string }) => {
	const manifest = await readRunManifest({ cwd, runId });

	if ((manifest.pipeline ?? 'implement') !== 'refactor') {
		return undefined;
	}

	const worklist = RefactorWorklist.parse(JSON.parse(await readFile(join(cwd, manifest.plan), 'utf8')));

	return { worklist, steps: manifest.steps };
};

/**
 * One batch's blocking sites, tallied against what its report says happened.
 * Every frozen site counts as attempted; a site absent from the remaining keys
 * was resolved, one still there in a declined batch was declined, and anything
 * else — including every site of a batch with no parseable report — is
 * untracked, because a batch that failed is not a batch that judged.
 */
const countBatchSites = ({ tallies, blocking, report }: { tallies: Map<string, Tally>; blocking: StandardsFinding[]; report?: BatchReport }) => {
	const remaining = report ? new Set(report.remainingSiteKeys) : undefined;
	const leftStanding = new Set<string>();

	for (const finding of blocking) {
		const tally = tallyFor({ tallies, rule: finding.rule });

		tally.attempted += 1;

		if (remaining === undefined) {
			tally.untracked += 1;
			continue;
		}

		if (!remaining.has(finding.siteKey)) {
			tally.resolved += 1;
			continue;
		}

		leftStanding.add(finding.rule);

		if (report?.outcome === BatchOutcome.Declined) {
			tally.declined += 1;
		} else {
			tally.untracked += 1;
		}
	}

	// The rationale is recorded per batch, not per site, so it attaches to every
	// rule that still had a site standing when the batch ended — reporting what
	// was recorded rather than inventing an attribution nobody wrote down.
	for (const rule of leftStanding) {
		tallyFor({ tallies, rule }).reasons.push(...(report?.rationale ?? []));
	}
};

/** The agent's own account of the advice it was shown — the only record judgment-only rules ever get. */
const countAdvice = ({ tallies, outcomes }: { tallies: Map<string, Tally>; outcomes: AdvisoryOutcome[] }) => {
	for (const entry of outcomes) {
		const tally = tallyFor({ tallies, rule: entry.rule });

		if (entry.outcome === AdvisoryResponse.Applied) {
			tally.adviceApplied += 1;
			continue;
		}

		// Counted apart from both: nothing was done and nothing was rejected, so
		// folding it into either number would misreport how often the advice is
		// worth its noise.
		if (entry.outcome === AdvisoryResponse.AlreadyMet) {
			tally.adviceAlreadyMet += 1;
			continue;
		}

		tally.adviceDeclined += 1;

		if (entry.reason !== undefined) {
			tally.reasons.push(entry.reason);
		}
	}
};

interface Params {
	cwd: string;
	packs: LoadedStandardsPack[];
}

/**
 * The pack-health report: which rules code checks and which are judgment,
 * counted from the pack's own folders, and how often agents declined each
 * rule's findings, aggregated from this repo's persisted refactor runs.
 *
 * The two questions are deliberately separate from `standards-check`. That
 * command asks whether the code is clean today; this one asks which rules are
 * worth their noise — a question about the rules, answerable only across runs.
 *
 * A run whose manifest or work-list cannot be read is skipped in silence: the
 * report aggregates what is readable, and one corrupt run directory must not
 * take the whole account down with it.
 *
 * @param cwd - the repo whose `.lightsout/runs` history is read
 * @param packs - the loaded standards packs, which supply every rule the report has a row for
 */
export const buildStandardsHealth = async ({ cwd, packs }: Params): Promise<StandardsHealth> => {
	const tallies = new Map<string, Tally>();

	for (const runId of await listRunIds({ cwd })) {
		const run = await readRefactorRun({ cwd, runId }).catch(() => undefined);

		if (run === undefined) {
			continue;
		}

		for (const batch of run.worklist.batches) {
			const parsed = BatchReport.safeParse(run.steps.find((step) => step.id === batch.id)?.report);
			const report = parsed.success ? parsed.data : undefined;

			countBatchSites({ tallies, blocking: batch.blocking, report });
			countAdvice({ tallies, outcomes: report?.advisoryOutcomes ?? [] });
		}
	}

	const rules: StandardsHealthRule[] = packs
		.flatMap((pack) => pack.rules)
		.map((rule) => ({
			id: rule.id,
			set: rule.set,
			documentPath: rule.documentPath,
			checked: rule.checked,
			...(tallies.get(rule.id) ?? emptyTally()),
		}))
		.sort((first, second) => first.id.localeCompare(second.id));
	const checked = rules.filter((rule) => rule.checked).length;

	return { rules, totals: { rules: rules.length, checked, judgment: rules.length - checked } };
};
