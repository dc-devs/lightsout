import type { StructuralFinding } from '@lightsout/contracts';
import { dim } from '../terminal/dim';
import { yellow } from '../terminal/yellow';

interface Params {
	finding: StructuralFinding;
}

/** Render one plan structural finding to stdout: the ⚠ icon, check, location and issue, with its fix on the following dim line. */
export const printStructuralFinding = ({ finding }: Params): void => {
	console.log(`${yellow('⚠')} [${finding.check}] ${finding.location} — ${finding.issue}`);
	console.log(dim(`   fix: ${finding.fix}`));
};
