import { dim } from '#src/cli/common/terminal/dim.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import type { StructuralFinding } from '#src/contracts/index.ts';

interface Params {
	finding: StructuralFinding;
}

/** Render one plan structural finding to stdout: the ⚠ icon, check, location and issue, with its fix on the following dim line. */
export const printStructuralFinding = ({ finding }: Params): void => {
	console.log(`${yellow('⚠')} [${finding.check}] ${finding.location} — ${finding.issue}`);
	console.log(dim(`   fix: ${finding.fix}`));
};
