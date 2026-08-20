import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printFindingGroups } from '#src/cli/common/render/printFindingGroups.ts';
import { printStandardsRuleList } from '#src/cli/common/render/printStandardsRuleList.ts';
import { printStandardsSummary } from '#src/cli/common/render/printStandardsSummary.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { loadStandardsLedger } from '#src/cli/loadStandardsLedger.ts';
import { reviewStandards } from '#src/cli/reviewStandards.ts';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { runStandardsCheck, writeStandardsSnapshot } from '#src/standardsCheck/index.ts';

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
		// Persistence is this command's job, not the check's: the merged stream is
		// what the reader was shown, and two writers to one file would race.
		const checked = await runStandardsCheck({
			cwd,
			path: checkPath,
			all: flags.get('all') === true,
			writeBaseline: flags.get('baseline') === true,
			persist: false,
			onProgress: (message) => console.log(dim(message)),
		});

		findings.push(...checked.findings);
		notes.push(...checked.notes);
	}

	if (runAgentReview) {
		const reviewed = await reviewStandards({ cwd, config, path: checkPath });

		findings.push(...reviewed.findings);
		notes.push(...reviewed.notes);
	}

	// Findings lead: they are the work, and an advisory read first would set the
	// wrong expectation about what the run is asking for.
	const ordered = [
		...findings.filter((entry) => entry.severity === StandardsSeverity.Blocking),
		...findings.filter((entry) => entry.severity === StandardsSeverity.Advisory),
	];

	printFindingGroups({ findings: ordered });

	if (notes.length > 0) {
		console.log('');
	}

	for (const note of notes) {
		console.log(`${dim('ℹ')} ${dim(note)}`);
	}

	// The evidence file is the machine half's work-list, so a review-only run
	// leaves it exactly as the last real check left it rather than overwriting
	// it with a judgment call.
	if (runCodeChecks) {
		await writeStandardsSnapshot({ cwd, snapshot: { at: new Date().toISOString(), path: checkPath ?? '.', findings: ordered, notes } });
	}

	printStandardsSummary({ findings: ordered, rules, reportPath: runCodeChecks ? '.lightsout/standards-check.json' : undefined });
	return exitCli({ code: 0 });
};
