import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { AgentUsage, type PlanningCanonicalProgress } from '#src/contracts/index.ts';
import { planningStorePaths } from '#src/plan/workflow/index.ts';

/**
 * The part of a local call record this reader is allowed to look at.
 *
 * The recorder writes the harness's reply text beside the usage, and nothing
 * outside the store may carry it: a diagnostic that printed a transcript would
 * put model output back in front of a model. Zod drops every key the shape does
 * not name, so the text never leaves this file.
 */
const callRecord = z.object({ callId: z.string().min(1), usage: AgentUsage.nullish() });

interface Params {
	cwd: string;
	name: string;
}

/**
 * What this plan's recorded provider calls cost, deduplicated by call id.
 *
 * A restored generation replays the calls it was exported with, so the same
 * call can sit under two file names; counting both would bill one invocation
 * twice. A call whose harness reported nothing is counted in `unreported` and
 * contributes no number — an unknown spend summed as zero is the lie this
 * count exists to avoid, which is also why `totals` is absent rather than zero
 * when no call reported at all.
 */
export const readPlanningCallUsage = async ({ cwd, name }: Params): Promise<PlanningCanonicalProgress['usage']> => {
	const paths = await planningStorePaths({ cwd, name });
	const entries = await readdir(paths.local).catch(() => []);
	const seen = new Map<string, AgentUsage | undefined>();

	for (const entry of entries.filter((candidate) => candidate.endsWith('.json')).sort()) {
		const record = await readJsonFile({ path: join(paths.local, entry), schema: callRecord });

		if (record !== undefined && !seen.has(record.callId)) {
			seen.set(record.callId, record.usage ?? undefined);
		}
	}

	const reported = [...seen.values()].filter((usage) => usage !== undefined);
	const totals = reported.reduce<AgentUsage | undefined>(
		(sum, usage) =>
			sum === undefined
				? { ...usage }
				: {
						inputTokens: sum.inputTokens + usage.inputTokens,
						outputTokens: sum.outputTokens + usage.outputTokens,
						cacheReadTokens: sum.cacheReadTokens + usage.cacheReadTokens,
						cacheCreationTokens: sum.cacheCreationTokens + usage.cacheCreationTokens,
						costUsd: sum.costUsd + usage.costUsd,
					},
		undefined,
	);

	return { calls: seen.size, unreported: seen.size - reported.length, ...(totals === undefined ? {} : { totals }) };
};
