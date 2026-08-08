import { StandardsSeverity } from '@/contracts';
import { loadConfig } from '@/common/utils/loadConfig';
import { listStandardsRules, runStandardsCheck } from '@/standardsCheck';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { printFindingGroups } from '@/cli/common/render/printFindingGroups';
import { printStandardsRuleList } from '@/cli/common/render/printStandardsRuleList';
import { printStandardsSummary } from '@/cli/common/render/printStandardsSummary';
import { dim } from '@/cli/common/terminal/dim';
import type { CommandContext } from '@/cli/common/types/CommandContext';

const reportPath = '.lightsout/standards-check.json';

export const standardsCheckCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	// --list answers "what does this repo enforce?" and runs nothing. A repo
	// without a config still has an answer — every rule at its default — so a
	// missing config is tolerated here exactly as the run path tolerates it.
	if (flags.get('list') === true) {
		const config = await loadConfig({ cwd }).catch(() => undefined);

		printStandardsRuleList({ rules: listStandardsRules({ config }) });
		process.exit(0);
	}

	const checkPath = getStringFlag({ flags, name: 'path' });
	const { findings, notes } = await runStandardsCheck({
		cwd,
		path: checkPath,
		all: flags.get('all') === true,
		writeBaseline: flags.get('baseline') === true,
		onProgress: (message) => console.log(dim(message)),
	});

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

	printStandardsSummary({ findings: ordered, reportPath });
	process.exit(0);
};
