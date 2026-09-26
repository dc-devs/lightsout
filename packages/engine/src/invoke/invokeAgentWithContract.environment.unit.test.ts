import { describe, expect, test } from '@jest/globals';
import { WorkReport } from '#src/contracts/work/WorkReport.ts';
import type { AgentEnvironment } from '#src/drivers/common/types/AgentEnvironment.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';
import { report } from '#tests/helpers/report.ts';

const roleInvocation = { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' };

/**
 * A final message that IS valid JSON but not a valid WorkReport — `summary`
 * must be a string. There is an object to reconstruct from, so the rejection
 * earns the cheap re-emit rung this file is about.
 */
const objectBearingRejection = report({ summary: 42 });

/**
 * A driver that fails the contract once and then answers it, recording the
 * environment and the prompt of every rung it was handed. A re-emit rung is
 * told apart by its prompt: it is the one carrying `# Validation error`.
 */
const setupEnvironmentRelay = () => {
	const environments: (AgentEnvironment | undefined)[] = [];
	const prompts: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, environment }: DriverInvocation) => {
			prompts.push(prompt);
			environments.push(environment);

			return prompts.length === 1 ? { text: objectBearingRejection, exitCode: 0 } : { text: report({ summary: 'answered on the re-emit rung' }), exitCode: 0 };
		},
	};

	const isReemit = (prompt: string) => prompt.includes('# Validation error');

	return { driver, environments, prompts, isReemit };
};

describe('invokeAgentWithContract: the requested agent environment', () => {
	test('carries the requested environment onto the re-emit rung', async () => {
		const { driver, environments, prompts, isReemit } = setupEnvironmentRelay();

		const { ok, report: parsed } = outcomeFields(
			await invokeAgentWithContract({
				driver,
				cwd: '.',
				invocation: roleInvocation,
				contract: WorkReport,
				environment: {
					noMcpServers: true,
					noSkillCatalog: true,
					toolAllowlist: true,
					settingsPreserved: true,
					tools: ['Read', 'Write'],
				},
			}),
		);

		expect(ok).toBe(true);
		expect(parsed?.summary).toBe('answered on the re-emit rung');
		// the role rung, then its cheap re-emit
		expect(prompts.map(isReemit)).toStrictEqual([false, true]);
		// a re-emit spawned without the environment would be a second, untested
		// process shape — the retry runs against the same harness as the role
		expect(environments).toStrictEqual([
			{ noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true, tools: ['Read', 'Write'] },
			{ noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true, tools: ['Read', 'Write'] },
		]);
	});
});
