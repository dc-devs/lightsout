import { buildSupervisorInvocation } from '@lightsout/agents';
import { SupervisorVerdict, type LightsoutConfig } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { invokeAgentWithContract } from '../../invoke';

const defaultSupervisorTimeoutMinutes = 15;
const supervisorPermissionMode = 'plan';

interface Params {
	driver: Driver;
	cwd: string;
	config: LightsoutConfig;
	/** The plan text (or standalone banner), for the supervisor's context. */
	planContent: string;
	stepId: string;
	/** The verification-gate output that keeps failing. */
	errorOutput: string;
	attempts: number;
	onEvent?: (event: unknown) => void;
	onRejectedOutput?: (params: { text: string; attempt: number; validationError: string }) => Promise<void> | void;
}

/**
 * The exception-path judgment call, shared by every pipeline that verifies
 * with gates: after cheap mechanical retries are exhausted, a read-only
 * supervisor diagnoses the failure and either grants one guided retry or
 * rules it a human problem. Callers own usage recording and the verdict.
 */
export const consultSupervisor = async ({ driver, cwd, config, planContent, stepId, errorOutput, attempts, onEvent, onRejectedOutput }: Params) => {
	return invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildSupervisorInvocation({ planContent, stepId, errorOutput, attempts }),
		contract: SupervisorVerdict,
		model: config.model,
		permissionMode: supervisorPermissionMode,
		timeoutMs: (config.timeouts?.supervisorMinutes ?? defaultSupervisorTimeoutMinutes) * 60_000,
		onEvent,
		onRejectedOutput,
	});
};
