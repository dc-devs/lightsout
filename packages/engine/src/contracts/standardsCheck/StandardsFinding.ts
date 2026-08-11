import { RawStandardsFinding } from '@lightsout/standards-contracts';
import { z } from 'zod';
import { StandardsSeverity } from '@/contracts/standardsCheck/StandardsSeverity';

/**
 * One structural defect found by `lightsout standards-check`. Typed because
 * this is v2's remediation work-list: a refactor agent gets handed a grouped
 * set of findings, never "go find problems".
 *
 * What a check emits plus the two fields only the engine can fill in. The shared
 * fields come from `RawStandardsFinding.shape` rather than being restated, so
 * the two shapes cannot drift: every field a check emits is a field the engine
 * persists.
 *
 * Spread rather than `.extend()` so `rule` and `severity` stay first. Zod
 * returns parsed keys in declaration order, and these findings are written to
 * .lightsout/standards-check.json — appending the two would reorder every key in
 * a file people read, for no reason a reader could work out.
 */
export const StandardsFinding = z.object({
	/**
	 * The rule's id, as its folder in a standards package names it. A free
	 * string rather than a closed list: rule identity belongs to the loaded
	 * packages, and the only place the valid ids are known is where those
	 * packages have been read.
	 */
	rule: z.string(),
	/**
	 * Only the two reporting severities. `off` is a CONFIGURATION state — a
	 * rule a repo switched off emits nothing, so a persisted finding at
	 * severity `off` would be a contradiction the schema should refuse.
	 */
	severity: z.enum([StandardsSeverity.Blocking, StandardsSeverity.Advisory]),
	...RawStandardsFinding.shape,
});

export type StandardsFinding = z.infer<typeof StandardsFinding>;
