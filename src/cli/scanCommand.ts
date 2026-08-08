import { StandardsSeverity } from '@/contracts';
import { runScan } from '@/scan';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { printFindingGroups } from '@/cli/common/render/printFindingGroups';
import { printScanSummary } from '@/cli/common/render/printScanSummary';
import { dim } from '@/cli/common/terminal/dim';
import type { CommandContext } from '@/cli/common/types/CommandContext';

const reportPath = '.lightsout/scan.json';

export const scanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const scanPath = getStringFlag({ flags, name: 'path' });
	const { findings, notes } = await runScan({
		cwd,
		path: scanPath,
		all: flags.get('all') === true,
		writeBaseline: flags.get('baseline') === true,
		onProgress: (message) => console.log(dim(message)),
	});

	// Findings lead: they are the work, and an advisory read first would set the
	// wrong expectation about what the run is asking for.
	const ordered = [
		...findings.filter((entry) => entry.severity === StandardsSeverity.Finding),
		...findings.filter((entry) => entry.severity === StandardsSeverity.Advisory),
	];

	printFindingGroups({ findings: ordered });

	if (notes.length > 0) {
		console.log('');
	}

	for (const note of notes) {
		console.log(`${dim('ℹ')} ${dim(note)}`);
	}

	printScanSummary({ findings: ordered, reportPath });
	process.exit(0);
};
