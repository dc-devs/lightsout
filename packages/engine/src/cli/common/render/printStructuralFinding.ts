import { dim } from '#src/cli/common/terminal/dim.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { FindingSeverity, type StructuralFinding } from '#src/contracts/index.ts';

interface Params {
	finding: StructuralFinding;
	/** Where the two lines go — stdout by default; a command reporting findings as its failure passes `console.error`. */
	write?: (line: string) => void;
}

/**
 * Render one plan structural finding: its severity marker (the ⚠ icon when it
 * blocks, a dim `note` when it only informs), then the plan file it came from,
 * the check, location and issue, with its fix on the following dim line. The
 * phase label leads every line so a twenty-finding phased run is navigable.
 */
export const printStructuralFinding = ({ finding, write = console.log }: Params): void => {
	const marker = finding.severity === FindingSeverity.Advisory ? dim('note') : yellow('⚠');

	write(`${marker} ${finding.phase} [${finding.check}] ${finding.location} — ${finding.issue}`);
	write(dim(`   fix: ${finding.fix}`));
};
