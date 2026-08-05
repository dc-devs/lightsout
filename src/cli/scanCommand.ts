import { join } from 'node:path';
import { runScan } from '@/scan';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { printFinding } from '@/cli/common/render/printFinding';
import { dim } from '@/cli/common/terminal/dim';
import type { CommandContext } from '@/cli/common/types/CommandContext';

export const scanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const scanPath = getStringFlag({ flags, name: 'path' });
	const { findings, notes } = await runScan({
		cwd,
		path: scanPath,
		all: flags.get('all') === true,
		writeBaseline: flags.get('baseline') === true,
		onProgress: (message) => console.log(dim(message)),
	});
	const bySeverity = { finding: findings.filter((entry) => entry.severity === 'finding'), advisory: findings.filter((entry) => entry.severity === 'advisory') };

	console.log('');

	for (const entry of [...bySeverity.finding, ...bySeverity.advisory]) {
		printFinding({ entry });
	}

	for (const note of notes) {
		console.log(`${dim('ℹ')} ${'note'.padEnd(20)}${note}`);
	}

	const detectors = new Map<string, number>();

	for (const entry of findings) {
		detectors.set(entry.detector, (detectors.get(entry.detector) ?? 0) + 1);
	}

	const breakdown = [...detectors.entries()].map(([name, count]) => `${name} ${count}`).join(' · ');

	console.log(`\n${findings.length} finding(s)${findings.length > 0 ? ` · ${breakdown}` : ''} — report: .lightsout/scan.json`);
	process.exit(0);
};
