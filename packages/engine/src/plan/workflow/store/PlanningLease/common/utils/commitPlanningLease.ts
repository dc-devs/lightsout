import { link } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningStoreIO } from '#src/plan/workflow/common/types/PlanningStoreIO.ts';
import { flushPlanningDirectory } from '#src/plan/workflow/store/common/utils/flushPlanningDirectory.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';
import { writePlanningBlob } from '#src/plan/workflow/store/common/utils/writePlanningBlob.ts';
import { PlanningLeaseEntry } from '#src/plan/workflow/store/PlanningLease/common/types/PlanningLeaseEntry.ts';

interface Params {
	io?: PlanningStoreIO;
	directory: string;
	entry: PlanningLeaseEntry;
}

/** Renewal and an expiry fence compete for the same immutable revision slot. */
export const commitPlanningLease = async ({ directory, entry: proposed, io }: Params): Promise<boolean> => {
	const entry = PlanningLeaseEntry.parse(proposed);
	const digest = sha256({ content: canonicalJson({ value: entry }) });
	const candidate = join(directory, `${digest}.candidate`);
	await writePlanningBlob({ path: candidate, text: canonicalJson({ value: { entry, digest } }) });
	await io?.checkpoint?.({ operation: 'lease-candidate', path: candidate });
	let committed = true;
	try {
		await link(candidate, join(directory, `${String(entry.revision).padStart(10, '0')}.json`));
	} catch (error) {
		if (!(planningErrorCode({ error }) === 'EEXIST')) throw error;
		committed = false;
	}
	if (committed) await flushPlanningDirectory({ path: directory });
	return committed;
};
