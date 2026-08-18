import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { printFindingGroups } from '@/cli/common/render/printFindingGroups';
import { printStandardsRuleList } from '@/cli/common/render/printStandardsRuleList';
import { printStandardsSummary } from '@/cli/common/render/printStandardsSummary';
import { dim } from '@/cli/common/terminal/dim';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { loadStandardsLedger } from '@/cli/loadStandardsLedger';
import { reviewStandards } from '@/cli/reviewStandards';
import { type StandardsFinding, StandardsSeverity } from '@/contracts';
import { runStandardsCheck } from '@/standardsCheck';

const reportPath = '.lightsout/standards-check.json';

/** The typed evidence file the refactor pipeline reads as its work-list, written once per run by the command that owns it. */
const writeCheckReport = async ({ cwd, path, findings, notes }: { cwd: string; path?: string; findings: StandardsFinding[]; notes: string[] }) => {
	await mkdir(join(cwd, '.lightsout'), { recursive: true });
	await writeFile(
		join(cwd, '.lightsout', 'standards-check.json'),
		`${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', findings, notes }, undefined, '\t')}\n`,
		'utf8',
	);
};

export const standardsCheckCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	// Both paths need the ledger: `--list` prints it whole, the run path reads
	// each rule's summary from it.
	const { config, rules } = await loadStandardsLedger({ cwd });

	// --list answers "what does this repo enforce?" and runs nothing.
	if (flags.get('list') === true) {
		printStandardsRuleList({ rules });
		process.exit(0);
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
		await writeCheckReport({ cwd, path: checkPath, findings: ordered, notes });
	}

	printStandardsSummary({ findings: ordered, rules, reportPath: runCodeChecks ? reportPath : undefined });
	process.exit(0);
};
