import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { DriverResult } from '#src/drivers/index.ts';
import { planningStorePaths, writePlanningBlob } from '#src/plan/workflow/store/index.ts';

interface Params {
	cwd: string;
	name: string;
	workId: string;
	attemptId: string;
	result: DriverResult;
	startedAt: number;
	endedAt: number;
}

/** Record each actual Driver rung once; absent usage stays unknown and never becomes a completion budget. */
export const recordPlanningUsage = async ({ cwd, name, workId, attemptId, result, startedAt, endedAt }: Params): Promise<void> => {
	const paths = await planningStorePaths({ cwd, name, create: true });
	const callId = randomUUID();
	const value = {
		callId,
		workId,
		attemptId,
		startedAt,
		endedAt,
		elapsedMs: Math.max(0, endedAt - startedAt),
		usage: result.usage ?? null,
		exitCode: result.exitCode,
		rateLimited: result.rateLimited ?? false,
		text: result.text,
	};
	await writePlanningBlob({ path: join(paths.local, `${callId}.json`), text: canonicalJson({ value }) });
};
