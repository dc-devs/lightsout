import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const grant = 'pnpm --filter api run prisma:migrate:dev:name';

test('agentCommands: grant section reaches the executor, driver gets allowedCommands, test writers stay ungranted', async () => {
	const dir = setupConsumerRepo({ config: { 'agent-commands': [grant] } });

	const invocations: { role: string; systemPrompt?: string; allowedCommands?: string[] }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt, allowedCommands }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			invocations.push({ role, systemPrompt, allowedCommands });

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	expect(result.ok).toBe(true);

	const implement = invocations.find((invocation) => invocation.role === 'implement');
	const writer = invocations.find((invocation) => invocation.role === 'write-tests');

	// The grant is stable for the whole run, so it rides the cached system prompt.
	// executor role prompt carries the grant section
	expect(implement?.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands')).toBeTruthy();
	// grant lists the exact prefix
	expect(implement?.systemPrompt?.includes(grant)).toBeTruthy();
	// driver receives allowedCommands for the executor
	expect(implement?.allowedCommands).toStrictEqual([grant]);
	// test-writer role prompt has no grant section
	expect(writer?.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
	// harness-level allowance is uniform for working roles
	expect(writer?.allowedCommands).toStrictEqual([grant]);
});

test('agentCommands absent: no grant section, no allowedCommands', async () => {
	const dir = setupConsumerRepo();

	let implementInvocation: { systemPrompt?: string; allowedCommands?: string[] } | undefined;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt, allowedCommands }) => {
			if (roleOf(prompt) === 'implement') {
				implementInvocation = { systemPrompt, allowedCommands };
			}

			return { text: 'no report', exitCode: 0 };
		},
	};

	const config = await loadConfig({ cwd: dir });

	await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	// executor was invoked
	expectDefined(implementInvocation);
	expect(implementInvocation.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
	expect(implementInvocation.allowedCommands).toBe(undefined);
});
