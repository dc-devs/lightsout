import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import type { StandardsFinding } from '#src/contracts/standardsCheck/StandardsFinding.ts';
import { StandardsSeverity } from '#src/contracts/standardsCheck/StandardsSeverity.ts';
import type { StandardsRuleView } from '#src/contracts/views/StandardsRuleView.ts';
import type { StandardsView } from '#src/contracts/views/StandardsView.ts';
import { buildStandardsHealth } from '#src/standardsCheck/buildStandardsHealth.ts';
import type { StandardsHealthRule } from '#src/standardsCheck/common/types/StandardsHealthRule.ts';
import type { StandardsRuleListing } from '#src/standardsCheck/common/types/StandardsRuleListing.ts';
import { listStandardsRules } from '#src/standardsCheck/listStandardsRules.ts';
import { listStandardsSnapshots } from '#src/standardsCheck/listStandardsSnapshots.ts';
import { readStandardsSnapshot } from '#src/standardsCheck/readStandardsSnapshot.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/common/types/LoadedStandardsRule.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/resolveStandardsPacks.ts';

/** Open findings per rule id, counted once so no row has to scan the snapshot for itself. */
const countByRule = ({ findings }: { findings: StandardsFinding[] }) => {
	const counts = new Map<string, number>();

	for (const finding of findings) {
		counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
	}

	return counts;
};

/** One rule's row: the listing's account of how this repo runs it, joined to the rule's own prose and its refactor history. */
const buildRuleView = ({
	listing,
	rule,
	health,
	findingCount,
}: {
	listing: StandardsRuleListing;
	rule: LoadedStandardsRule;
	health: StandardsHealthRule;
	findingCount: number;
}): StandardsRuleView => {
	return {
		rule: listing.rule,
		doc: listing.doc,
		documentPath: rule.documentPath,
		set: rule.set,
		summary: listing.summary,
		prose: rule.prose,
		checked: listing.checked,
		severity: listing.severity,
		fromConfig: listing.fromConfig,
		settings: listing.settings,
		findingCount,
		history: {
			attempted: health.attempted,
			resolved: health.resolved,
			declined: health.declined,
			untracked: health.untracked,
			adviceApplied: health.adviceApplied,
			adviceDeclined: health.adviceDeclined,
			adviceAlreadyMet: health.adviceAlreadyMet,
			reasons: health.reasons,
		},
	};
};

interface Params {
	cwd: string;
}

/**
 * The standards view's whole payload: the latest snapshot's findings, every
 * loaded rule, and the trend across the checks this repo has run.
 *
 * Every loaded rule gets a row even with no open findings — the view answers
 * "what does this repo enforce?", not only "what is broken today". A repo with
 * no snapshot yet still answers the first question, which is why the absence is
 * a normal state rather than a failure.
 *
 * @param cwd - the repo whose config, packs, run history and snapshots are read
 * @throws {Error} When a declared standards pack cannot be loaded, or the config names a rule no pack declares.
 */
export const getStandardsView = async ({ cwd }: Params): Promise<StandardsView> => {
	const config = await readOptionalConfig({ cwd });
	const packs = await resolveStandardsPacks({ cwd, config });
	const listings = await listStandardsRules({ cwd, config });
	const health = await buildStandardsHealth({ cwd, packs });
	const snapshot = await readStandardsSnapshot({ cwd });
	const findings = snapshot?.findings ?? [];
	const loaded = new Map(packs.flatMap((pack) => pack.rules).map((rule) => [rule.id, rule]));
	const counts = countByRule({ findings });
	const rules: StandardsRuleView[] = [];

	for (const listing of listings) {
		const rule = loaded.get(listing.rule);
		const ruleHealth = health.rules.find((entry) => entry.id === listing.rule);

		// Every listed rule was loaded from a pack and given a health row, so
		// this skips nothing in practice — it is what keeps a row from ever being
		// built out of half an answer.
		if (rule === undefined || ruleHealth === undefined) {
			continue;
		}

		rules.push(buildRuleView({ listing, rule, health: ruleHealth, findingCount: counts.get(listing.rule) ?? 0 }));
	}

	return {
		at: snapshot?.at,
		path: snapshot?.path ?? '.',
		notes: snapshot?.notes ?? [],
		findings,
		rules,
		trend: await listStandardsSnapshots({ cwd }),
		totals: {
			...health.totals,
			blocking: findings.filter((finding) => finding.severity === StandardsSeverity.Blocking).length,
			advisory: findings.filter((finding) => finding.severity === StandardsSeverity.Advisory).length,
			orphans: findings.filter((finding) => !loaded.has(finding.rule)).length,
		},
	};
};
