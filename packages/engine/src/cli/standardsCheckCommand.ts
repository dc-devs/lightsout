import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printFindingGroups } from '#src/cli/common/render/printFindingGroups.ts';
import { printSectionHeading } from '#src/cli/common/render/printSectionHeading.ts';
import { printStandardsRuleList } from '#src/cli/common/render/printStandardsRuleList.ts';
import { printStandardsSummary } from '#src/cli/common/render/printStandardsSummary.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { loadStandardsLedger } from '#src/cli/loadStandardsLedger.ts';
import { reviewStandards } from '#src/cli/reviewStandards.ts';
import { formatElapsed } from '#src/common/utils/formatElapsed.ts';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { runStandardsCheck, writeStandardsSnapshot } from '#src/standardsCheck/index.ts';

/** Progress lines sit under their section heading, indented and dim. */
const printProgress = (message: string) => console.log(dim(`  ${message}`));

/** Blocking first: findings are the work, and an advisory read first would set the wrong expectation about what a run is asking for. */
const orderBySeverity = ({ findings }: { findings: StandardsFinding[] }) => [
	...findings.filter((entry) => entry.severity === StandardsSeverity.Blocking),
	...findings.filter((entry) => entry.severity === StandardsSeverity.Advisory),
];

/** What the code checks found, in the words the finish line says it. */
const describeCodeFindings = ({ findings }: { findings: StandardsFinding[] }) => {
	const blocking = findings.filter((entry) => entry.severity === StandardsSeverity.Blocking).length;
	const advisories = findings.length - blocking;

	if (findings.length === 0) {
		return 'nothing found';
	}

	return [blocking > 0 ? `${blocking} blocking` : '', advisories > 0 ? `${advisories} advisor${advisories === 1 ? 'y' : 'ies'}` : '']
		.filter(Boolean)
		.join(', ');
};

/**
 * One section's result, printed the moment that half finishes: its findings
 * grouped by rule, then its notes. A reader waiting on the slow half is never
 * kept from the fast half's answer.
 */
const printSectionResult = ({ findings, notes }: { findings: StandardsFinding[]; notes: string[] }) => {
	// The group renderer opens each rule with its own blank line.
	if (findings.length > 0) {
		printFindingGroups({ findings });
	}

	if (notes.length > 0) {
		console.log('');
	}

	for (const note of notes) {
		console.log(`  ${dim('ℹ')} ${dim(note)}`);
	}
};

export const standardsCheckCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	// Both paths need the ledger: `--list` prints it whole, the run path reads
	// each rule's summary from it.
	const { config, rules } = await loadStandardsLedger({ cwd });

	// --list answers "what does this repo enforce?" and runs nothing.
	if (flags.get('list') === true) {
		printStandardsRuleList({ rules });
		return exitCli({ code: 0 });
	}

	// Neither flag names a half, so both run: this is a standards check, and both
	// halves are the check. Each flag names the actor, so what a reader switches
	// off is who does the work, not which rules apply.
	const codeChecksOnly = flags.get('code-checks') === true;
	const agentReviewOnly = flags.get('agent-review') === true;
	const runCodeChecks = codeChecksOnly || !agentReviewOnly;
	const runAgentReview = agentReviewOnly || !codeChecksOnly;

	const checkPath = getStringFlag({ flags, name: 'path' });
	const findings: StandardsFinding[] = [];
	const notes: string[] = [];

	if (runCodeChecks) {
		printSectionHeading({ title: 'Code checks', subtitle: 'deterministic — the same answer every run' });

		const startedAt = Date.now();
		// Persistence is this command's job, not the check's: the merged stream is
		// what the reader was shown, and two writers to one file would race.
		const checked = await runStandardsCheck({
			cwd,
			path: checkPath,
			all: flags.get('all') === true,
			writeBaseline: flags.get('baseline') === true,
			persist: false,
			onProgress: printProgress,
		});
		const ordered = orderBySeverity({ findings: checked.findings });

		printProgress(`✓ Code checks finished in ${formatElapsed({ elapsedMs: Date.now() - startedAt })} — ${describeCodeFindings({ findings: ordered })}`);
		printSectionResult({ findings: ordered, notes: checked.notes });
		findings.push(...ordered);
		notes.push(...checked.notes);
	}

	if (runAgentReview) {
		// The review narrates itself — started, still running, finished — so the
		// heading is all the command adds.
		printSectionHeading({ title: 'Agent review' });

		const reviewed = await reviewStandards({ cwd, config, path: checkPath, onProgress: printProgress });

		printSectionResult({ findings: reviewed.findings, notes: reviewed.notes });
		findings.push(...reviewed.findings);
		notes.push(...reviewed.notes);
	}

	// The evidence file is the machine half's work-list, so a review-only run
	// leaves it exactly as the last real check left it rather than overwriting
	// it with a judgment call. Review findings are advisory by construction, so
	// the file keeps the blocking-first order the reader saw.
	if (runCodeChecks) {
		await writeStandardsSnapshot({ cwd, snapshot: { at: new Date().toISOString(), path: checkPath ?? '.', findings, notes } });
	}

	printStandardsSummary({ findings, rules, reportPath: runCodeChecks ? '.lightsout/standards-check.json' : undefined });
	return exitCli({ code: 0 });
};
