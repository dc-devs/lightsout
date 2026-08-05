import { ScanSeverity } from '@/contracts';
import type { ScanFinding } from '@/contracts';
import { dim } from '@/cli/common/terminal/dim';
import { yellow } from '@/cli/common/terminal/yellow';

interface Params {
	entry: ScanFinding;
}

/** Render one scan finding to stdout: the ⚠/ℹ severity icon, padded detector column, detail, and its file:line span on the following dim line. */
export const printFinding = ({ entry }: Params): void => {
	const icon = entry.severity === ScanSeverity.Finding ? yellow('⚠') : dim('ℹ');
	const where = entry.files
		.map((file) => `${file.path}${file.startLine ? `:${file.startLine}${file.endLine && file.endLine !== file.startLine ? `-${file.endLine}` : ''}` : ''}`)
		.join(', ');

	console.log(`${icon} ${entry.detector.padEnd(20)}${entry.detail}`);
	console.log(dim(`  ${''.padEnd(20)}${where}`));
};
