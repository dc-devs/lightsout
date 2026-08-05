import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

const grant = 'pnpm --filter api run prisma:migrate:dev:name';

test('agentCommands: grant section reaches the executor, driver gets allowedCommands, test writers stay ungranted', async () => {
	const dir = setupConsumerRepo({ config: { agentCommands: [grant] } });

	const invocations: { role: string; systemPrompt?: string; allowedCommands?: string[] }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt, allowedCommands }) => {
			const role = roleOf(prompt);

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

	assert.equal(result.ok, true);

	const implement = invocations.find((invocation) => invocation.role === 'implement');
	const writer = invocations.find((invocation) => invocation.role === 'write-tests');

	// The grant is stable for the whole run, so it rides the cached system prompt.
	assert.ok(implement?.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands'), 'executor role prompt carries the grant section');
	assert.ok(implement?.systemPrompt?.includes(grant), 'grant lists the exact prefix');
	assert.deepEqual(implement?.allowedCommands, [grant], 'driver receives allowedCommands for the executor');
	assert.ok(!writer?.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands'), 'test-writer role prompt has no grant section');
	assert.deepEqual(writer?.allowedCommands, [grant], 'harness-level allowance is uniform for working roles');
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

	assert.ok(implementInvocation, 'executor was invoked');
	assert.ok(!implementInvocation.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands'));
	assert.equal(implementInvocation.allowedCommands, undefined);
});
