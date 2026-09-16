import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { type PlanningRoleResult, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { type Driver, type DriverResult, getDriverCapabilities, getMissingEnvironmentControls } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { planningRoleEnvironment } from '#src/plan/workflow/common/constants/planningRoleEnvironment.ts';
import { assertPlanningDispatch } from '#src/plan/workflow/common/policy/assertPlanningDispatch.ts';
import { getPlanningRoleProtocol } from '#src/plan/workflow/common/runtime/getPlanningRoleProtocol.ts';
import { preparePlanningInvocation } from '#src/plan/workflow/common/runtime/preparePlanningInvocation.ts';
import { PlanningInvocationFailure } from '#src/plan/workflow/common/services/PlanningInvocationFailure.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { recordPlanningUsage } from '#src/plan/workflow/common/utils/recordPlanningUsage.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';

const environment = planningRoleEnvironment;

interface Params {
	runtime: PlanningRuntime;
	work: PlanningWork;
	snapshot: PlanningSnapshot;
	evidenceRequests?: Extract<PlanningRoleResult, { kind: typeof PlanningVocabulary.ResultKind.EvidenceRequest }>['requests'];
}

/** Observe each real provider call, including formatting rungs, without replacing its configured execution policy. */
const observedDriver = ({
	driver,
	standards,
	runtime,
	work,
	attemptId,
	persistenceFailed,
}: {
	runtime: PlanningRuntime;
	work: PlanningWork;
	attemptId: string;
	persistenceFailed: (error: PlanningInvocationFailure) => void;
	driver: Driver;
	standards: PlanningStandards;
}): Driver => {
	return {
		name: driver.name,
		invoke: async (invocation) => {
			await assertPlanningDispatch({ runtime, driver, work, standards });
			const startedAt = runtime.clock?.() ?? Date.now();
			let result: DriverResult;
			let providerError: unknown;
			try {
				result = await driver.invoke(invocation);
			} catch (error) {
				providerError = error;
				result = { text: messageOf({ error }), exitCode: 1 };
			}
			const pending = { workId: work.id, attemptId, result, startedAt, endedAt: runtime.clock?.() ?? Date.now() };
			runtime.pendingOutput = pending;
			try {
				await recordPlanningUsage({ cwd: runtime.cwd, name: runtime.name, ...pending });
			} catch (error) {
				const failure = new PlanningInvocationFailure({
					message: `Planning output persistence is unavailable: ${messageOf({ error })}`,
					externallyBlocked: true,
					preserveAttempt: true,
				});
				persistenceFailed(failure);
				throw failure;
			}
			runtime.pendingOutput = undefined;
			if (providerError !== undefined) throw providerError;
			return result;
		},
	};
};

const roleContract = ({ work }: { work: PlanningWork }) => {
	const contract = getPlanningRoleProtocol({ role: work.role }).schema.refine(
		(result) =>
			result.workId === work.id &&
			result.attemptId === work.currentAttemptId &&
			result.inputDigest === work.inputDigest &&
			result.invocationId !== undefined &&
			result.packetDigest !== undefined,
		'A planning response must echo its engine-issued invocation identity',
	);
	return contract;
};

const invocationPrompt = ({ work, prepared }: { work: PlanningWork; prepared: Awaited<ReturnType<typeof preparePlanningInvocation>> }): string => {
	const { binding, packet } = prepared;
	const identity = {
		role: work.role,
		workId: work.id,
		attemptId: work.currentAttemptId,
		inputDigest: work.inputDigest,
		invocationId: binding.id,
		packetDigest: binding.packetDigest,
	};
	const prompt = canonicalJson({
		value: {
			identity,
			context: JSON.parse(packet.prompt),
			citationSources: prepared.snapshot.record.sources.map((source) => ({
				artifact: source.artifact,
				locator: source.locator,
				sha256: source.sha256,
				capturedArtifact: `planning-originals/${source.sha256}.txt`,
			})),
			resultSchema: getPlanningRoleProtocol({ role: work.role }).jsonSchema,
		},
	});
	return prompt;
};

/** Dispatch one claimed logical assignment, durably continuing evidence requests until a valid terminal proposal arrives. */
export const invokePlanningRole = async ({ runtime, work, snapshot, evidenceRequests = [] }: Params): Promise<PlanningRoleResult> => {
	const driver = runtime.driver;
	const missing = getMissingEnvironmentControls({ environment, capabilities: getDriverCapabilities({ name: runtime.driver.name }) });
	if (missing.length > 0)
		throw new PlanningInvocationFailure({
			message: `The ${runtime.driver.name} harness cannot provide required planning controls: ${missing.join(', ')}`,
			externallyBlocked: true,
		});
	if (!work.currentAttemptId || work.status !== PlanningVocabulary.WorkState.Running) throw new Error('Planning role requires a claimed attempt');
	const attemptId = work.currentAttemptId;
	const standards = await resolvePlanningStandards({
		cwd: runtime.cwd,
		config: runtime.config,
		role: work.role,
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
	});
	const contract = roleContract({ work });
	let requests = evidenceRequests;
	let persistenceFailure: PlanningInvocationFailure | undefined;
	let current = snapshot;
	let leaseFailure: unknown;
	let heartbeat = Promise.resolve();
	const timer = setInterval(() => {
		heartbeat = heartbeat.then(async () => {
			try {
				await runtime.lease.renew({ attemptId: attemptId });
			} catch (error) {
				leaseFailure = error;
			}
		});
	}, 5_000);
	try {
		for (;;) {
			await runtime.lease.renew({ attemptId: work.currentAttemptId });
			const prepared = await preparePlanningInvocation({ runtime, snapshot: current, work, standards, requests });
			const { binding, packet } = prepared;
			const bound = contract.refine(
				(result) => result.invocationId === binding.id && result.packetDigest === binding.packetDigest,
				'A previous evidence rung cannot authorize this invocation',
			);
			if (!packet.execution) throw new Error('Planning execution arguments were not bound');
			const prompt = invocationPrompt({ work, prepared });
			const outcome = await invokeAgentWithContract({
				driver: observedDriver({
					driver,
					standards,
					runtime,
					work,
					attemptId,
					persistenceFailed: (error) => {
						persistenceFailure = error;
					},
				}),
				cwd: runtime.cwd,
				invocation: { systemPrompt: packet.systemPrompt, prompt },
				contract: bound,
				model: packet.execution.model,
				effort: packet.execution.effort,
				permissions: packet.execution.permissions,
				environment,
				timeoutMs: 3_600_000,
			});
			if (persistenceFailure) throw persistenceFailure;
			await heartbeat;
			if (leaseFailure) throw leaseFailure;
			if (!outcome.ok) throw new PlanningInvocationFailure({ message: outcome.failure, externallyBlocked: outcome.rateLimited });
			if (outcome.report.kind === PlanningVocabulary.ResultKind.Terminal) return outcome.report;
			requests = outcome.report.requests;
			current = prepared.snapshot;
		}
	} finally {
		clearInterval(timer);
		await heartbeat;
	}
};
