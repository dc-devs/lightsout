import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningDigest } from '#src/contracts/index.ts';
import { readPlanningFile } from '#src/plan/workflow/store/common/utils/readPlanningFile.ts';
import { PlanningLeaseStatus } from '#src/plan/workflow/store/PlanningLease/common/constants/PlanningLeaseStatus.ts';
import { PlanningLeaseEntry } from '#src/plan/workflow/store/PlanningLease/common/types/PlanningLeaseEntry.ts';

const envelope = z.object({ digest: PlanningDigest, entry: PlanningLeaseEntry }).strict();
interface Params {
	directory: string;
	attemptId: string;
}

/** Corrupt local coordination is an error, never proof that a currently running role was abandoned. */
export const readPlanningLease = async ({ directory, attemptId }: Params): Promise<{ entry: PlanningLeaseEntry; digest: string } | undefined> => {
	const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
	let previous: { entry: PlanningLeaseEntry; digest: string } | undefined;
	for (const [revision, name] of files.entries()) {
		if (name !== `${String(revision).padStart(10, '0')}.json`) throw new Error('Planning lease journal has a missing predecessor');
		const bytes = await readPlanningFile({ path: join(directory, name) });
		const current = envelope.parse(JSON.parse(bytes.toString('utf8')));
		if (
			!bytes.equals(Buffer.from(canonicalJson({ value: current }), 'utf8')) ||
			sha256({ content: canonicalJson({ value: current.entry }) }) !== current.digest
		)
			throw new Error('Planning lease journal checksum mismatch');
		if (current.entry.revision !== revision || current.entry.parentDigest !== (previous?.digest ?? null) || current.entry.attemptId !== attemptId)
			throw new Error('Planning lease journal identity mismatch');
		if (
			previous !== undefined &&
			(previous.entry.state === PlanningLeaseStatus.Fenced ||
				current.entry.token !== previous.entry.token ||
				current.entry.pid !== previous.entry.pid ||
				current.entry.expiresAt < previous.entry.expiresAt)
		)
			throw new Error('Planning lease journal has an illegal transition');
		previous = current;
	}
	return previous;
};
