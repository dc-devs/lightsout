import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';

interface Params<Shape> {
	path: string;
	schema: z.ZodType<Shape>;
	/** The entries as reported, before provenance is stamped on. */
	entries: Record<string, unknown>[];
	runId: string;
	/** Which step of the run reported them. */
	step: string;
}

/**
 * Append provenance-stamped records to one of the repo's append-only ledgers —
 * the writing half of {@link readJsonlRecords}.
 *
 * A ledger accumulates across runs, because what keeps being reported in the
 * same place is the signal and one run's view of it is not. Provenance is
 * stamped here rather than asked of the caller so every ledger answers "which
 * run, which step, when" the same way.
 *
 * Nothing reported means nothing written: an empty ledger and no ledger are the
 * same absence, and a file of zero records reads as an answer that was never
 * given.
 */
export const appendJsonlRecords = async <Shape>({ path, schema, entries, runId, step }: Params<Shape>): Promise<void> => {
	if (entries.length === 0) {
		return;
	}

	const at = new Date().toISOString();
	const lines = entries.map((entry) => JSON.stringify(schema.parse({ ...entry, at, runId, step }))).join('\n');

	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${lines}\n`, 'utf8');
};
