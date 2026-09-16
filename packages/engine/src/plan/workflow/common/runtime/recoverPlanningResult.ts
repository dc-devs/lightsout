import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { extractJsonReport } from '#src/invoke/index.ts';
import { applyPlanningResult } from '#src/plan/workflow/applyPlanningResult/index.ts';
import { readPlanningInvocation } from '#src/plan/workflow/common/runtime/readPlanningInvocation.ts';
import { recordPlanningFailure } from '#src/plan/workflow/common/runtime/recordPlanningFailure.ts';
import { PlanningInvocationFailure } from '#src/plan/workflow/common/services/PlanningInvocationFailure.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { recordPlanningUsage } from '#src/plan/workflow/common/utils/recordPlanningUsage.ts';
import { invokePlanningRole } from '#src/plan/workflow/invokePlanningRole.ts';
import { claimPlanningAttempt, planningStorePaths, readPlanningFile } from '#src/plan/workflow/store/index.ts';

const diagnostic = z.object({ workId: z.string(), attemptId: z.string(), text: z.string(), endedAt: z.number(), rateLimited: z.boolean().default(false) });

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
}

const persistPendingOutput = async ({ runtime }: Pick<Params, 'runtime'>) => {
	const pending = runtime.pendingOutput;
	if (pending) {
		try {
			await recordPlanningUsage({ cwd: runtime.cwd, name: runtime.name, ...pending });
		} catch (error) {
			throw new PlanningInvocationFailure({
				message: `Planning output persistence is unavailable: ${messageOf({ error })}`,
				externallyBlocked: true,
				preserveAttempt: true,
			});
		}
		runtime.pendingOutput = undefined;
		if (pending.result.rateLimited) {
			await recordPlanningFailure({
				runtime,
				workId: pending.workId,
				attemptId: pending.attemptId,
				failure: 'Harness rate limited; the saved output cannot authorize completion',
			});
			throw new PlanningInvocationFailure({ message: 'Harness rate limited; resume when provider capacity is available', externallyBlocked: true });
		}
	}
	return pending;
};

const collectCandidates = async ({
	runtime,
	running,
	pending,
}: Pick<Params, 'runtime'> & { running: PlanningSnapshot['record']['work']; pending: PlanningRuntime['pendingOutput'] }) => {
	const paths = await planningStorePaths({ cwd: runtime.cwd, name: runtime.name });
	const candidates: Array<{ result: PlanningRoleResult; endedAt: number; owned: boolean }> = [];
	for (const entry of await readdir(paths.local, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
		const text = (await readPlanningFile({ path: join(paths.local, entry.name) })).toString('utf8');
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			runtime.onProgress?.(`Ignored malformed local planning response ${entry.name}; the original file remains available for diagnosis.`);
			continue;
		}
		const row = diagnostic.safeParse(data);
		if (!row.success || row.data.rateLimited || !running.some((work) => work.id === row.data.workId && work.currentAttemptId === row.data.attemptId)) continue;
		const parsed = PlanningRoleResult.safeParse(extractJsonReport({ text: row.data.text }));
		const owned = pending?.workId === row.data.workId && pending.attemptId === row.data.attemptId && pending.result.text === row.data.text;
		if (
			parsed.success &&
			parsed.data.workId === row.data.workId &&
			parsed.data.attemptId === row.data.attemptId &&
			(parsed.data.kind === PlanningVocabulary.ResultKind.Terminal || owned)
		)
			candidates.push({ result: parsed.data, endedAt: row.data.endedAt, owned });
	}
	return candidates;
};

/** Recover real eligible output before replacing work; reject damaged candidates individually and preserve current ownership. */
export const recoverPlanningResult = async ({ runtime, snapshot }: Params): Promise<PlanningSnapshot | undefined> => {
	const pending = await persistPendingOutput({ runtime });
	const running = snapshot.record.work.filter((work) => work.stage === runtime.stage && work.status === PlanningVocabulary.WorkState.Running);
	if (running.length === 0) return undefined;
	const candidates = await collectCandidates({ runtime, running, pending });
	for (const { result, owned } of candidates.sort((a, b) => b.endedAt - a.endedAt)) {
		const invocation = readPlanningInvocation({ snapshot, workId: result.workId });
		if (!invocation || invocation.id !== result.invocationId || invocation.attemptId !== result.attemptId || invocation.packetDigest !== result.packetDigest)
			continue;
		const fenced = await runtime.lease.fenceExpired({ attemptId: result.attemptId });
		if (!owned && !fenced) continue;
		let recoveredRuntime = runtime;
		let activeSnapshot = snapshot;
		let activeWork = running.find((item) => item.id === result.workId);
		if (!activeWork) continue;
		if (fenced && result.kind === PlanningVocabulary.ResultKind.EvidenceRequest) {
			const claimed = await claimPlanningAttempt({ runtime, workId: activeWork.id, expectedInputDigest: activeWork.inputDigest });
			if (!claimed.claimed) return claimed.snapshot;
			activeSnapshot = claimed.snapshot;
			activeWork = claimed.snapshot.record.work.find((item) => item.id === result.workId);
			if (!activeWork) throw new Error('Recovered evidence request lost its newly claimed work');
		} else if (fenced) {
			const recoveryId = randomUUID();
			await runtime.lease.create({ attemptId: recoveryId });
			recoveredRuntime = {
				...runtime,
				lease: {
					create: (params) => runtime.lease.create(params),
					fenceExpired: (params) => runtime.lease.fenceExpired(params),
					renew: ({ attemptId }) => runtime.lease.renew({ attemptId: attemptId === result.attemptId ? recoveryId : attemptId }),
				},
			};
		}
		try {
			const terminal =
				result.kind === PlanningVocabulary.ResultKind.EvidenceRequest
					? await invokePlanningRole({ runtime: recoveredRuntime, snapshot: activeSnapshot, work: activeWork, evidenceRequests: result.requests })
					: result;
			const applied = await applyPlanningResult({ runtime: recoveredRuntime, result: terminal });
			if (applied.accepted) return applied.snapshot;
			return recordPlanningFailure({
				runtime,
				workId: result.workId,
				attemptId: activeWork.currentAttemptId ?? result.attemptId,
				failure: applied.reason ?? 'Saved output lost current input authority',
			});
		} catch (error) {
			if (recoveredRuntime.pendingOutput) runtime.pendingOutput = recoveredRuntime.pendingOutput;
			if (!(error instanceof PlanningInvocationFailure) || error.preserveAttempt) throw error;
			const rejected = await recordPlanningFailure({
				runtime,
				workId: result.workId,
				attemptId: activeWork.currentAttemptId ?? result.attemptId,
				failure: `Rejected saved planning proposal: ${error.message}`,
			});
			if (error.externallyBlocked) throw error;
			return rejected;
		}
	}
	return undefined;
};
