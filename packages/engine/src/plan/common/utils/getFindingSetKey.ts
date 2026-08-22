import type { StructuralFinding } from '#src/contracts/index.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';

interface Params {
	findings: StructuralFinding[];
}

/**
 * The blocking finding set as a comparable multiset key, so a repair loop can
 * tell a round that changed nothing from one that made progress.
 *
 * `location` is deliberately excluded: it carries a line number, and a repair
 * edit earlier in the file shifts every later finding's line — a stuck finding
 * that merely drifted would read as progress. `issue` already names the
 * specifics. Advisory findings are excluded outright: they are not defects, so
 * one persisting unchanged is not a stalled repair.
 */
export const getFindingSetKey = ({ findings }: Params): string =>
	getBlockingFindings({ findings })
		.map((finding) => [finding.check, finding.issue].join('|'))
		.sort()
		.join('\n');
