import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { loadConfig, runImplementPipeline } from '../src/index';
import { report } from './helpers/report';
import { roleOf } from './helpers/roleOf';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

const grant = 'pnpm --filter api run prisma:migrate:dev:name';

test('agentCommands: grant section reaches the executor, driver gets allowedCommands, test writers stay ungranted', async () => {
	const dir = setupConsumerRepo({ config: { agentCommands: [grant] } });

	const invocations: { role: string; prompt: string; allowedCommands?: string[] }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, allowedCommands }) => {
			const role = roleOf(prompt);

			invocations.push({ role, prompt, allowedCommands });

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

	assert.ok(implement?.prompt.includes('# Granted commands'), 'executor task carries the grant section');
	assert.ok(implement?.prompt.includes(grant), 'grant lists the exact prefix');
	assert.deepEqual(implement?.allowedCommands, [grant], 'driver receives allowedCommands for the executor');
	assert.ok(!writer?.prompt.includes('# Granted commands'), 'test-writer task has no grant section');
	assert.deepEqual(writer?.allowedCommands, [grant], 'harness-level allowance is uniform for working roles');
});

test('agentCommands absent: no grant section, no allowedCommands', async () => {
	const dir = setupConsumerRepo();

	let implementInvocation: { prompt: string; allowedCommands?: string[] } | undefined;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, allowedCommands }) => {
			if (roleOf(prompt) === 'implement') {
				implementInvocation = { prompt, allowedCommands };
			}

			return { text: 'no report', exitCode: 0 };
		},
	};

	const config = await loadConfig({ cwd: dir });

	await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	assert.ok(implementInvocation, 'executor was invoked');
	assert.ok(!implementInvocation.prompt.includes('# Granted commands'));
	assert.equal(implementInvocation.allowedCommands, undefined);
});
