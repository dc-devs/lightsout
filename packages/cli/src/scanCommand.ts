import { join } from 'node:path';
import { runScan } from '@lightsout/engine';
import { getStringFlag } from './common/args/getStringFlag';
import { dim } from './common/terminal/dim';
import { yellow } from './common/terminal/yellow';
import type { CommandContext } from './common/types/CommandContext';

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

	for (const [severity, list] of Object.entries(bySeverity)) {
		for (const entry of list) {
			const icon = severity === 'finding' ? yellow('⚠') : dim('ℹ');
			const where = entry.files
				.map((file) => `${file.path}${file.startLine ? `:${file.startLine}${file.endLine && file.endLine !== file.startLine ? `-${file.endLine}` : ''}` : ''}`)
				.join(', ');

			console.log(`${icon} ${entry.detector.padEnd(20)}${entry.detail}`);
			console.log(dim(`  ${''.padEnd(20)}${where}`));
		}
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
