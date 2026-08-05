import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { Driver, DriverInvocation } from '@lightsout/drivers';
import { loadConfig, runRefactorPipeline } from '../index';
import { report } from '../../tests/helpers/report';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alpha = 1;\nexport const beta = 2;\n';

/**
 * A green refactor run over one multi-export finding, whose stub driver records
 * every invocation the batch hands it — the capability level and reasoning
 * effort invokeBatchAgent resolves from config ride on those invocations.
 */
const setupBatchPolicy = async ({ config }: { config?: Record<string, unknown> } = {}) => {
	const dir = setupConsumerRepo({ config });

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			const target = invocation.prompt.match(/- (\S+\.ts)/)?.[1];

			if (!target) {
				return { text: report(), exitCode: 0 };
			}

			const beta = target.replace(/([^/]+)\.ts$/, 'beta.ts');

			writeFileSync(join(dir, target), 'export const alpha = 1;\n');
			writeFileSync(join(dir, beta), 'export const beta = 2;\n');

			return { text: report({ changedFiles: [{ path: target, summary: 'split' }, { path: beta, summary: 'split' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }), invocations };
};

/** The distinct effort/permission pairs a run's invocations were spawned at. */
const distinctPolicies = (invocations: DriverInvocation[]) =>
	[...new Set(invocations.map((invocation) => `${String(invocation.effort)}/${String(invocation.permissions)}`))];

describe('invokeBatchAgent — via runRefactorPipeline', () => {
	test('defaults a batch invocation to write permissions and the harness default effort when config sets neither', async () => {
		const { dir, driver, config, invocations } = await setupBatchPolicy();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		assert.equal(result.ok, true, result.error);
		assert.ok(invocations.length > 0, 'the stub driver was invoked');
		assert.deepEqual(
			distinctPolicies(invocations),
			['undefined/write'],
			`a refactor executor must be able to write, and an unset effort is the harness's to choose: ${JSON.stringify(invocations.map(({ effort, permissions }) => ({ effort, permissions })))}`,
		);
	});

	test('passes a configured effort and full-access level to every batch invocation', async () => {
		const { dir, driver, config, invocations } = await setupBatchPolicy({ config: { effort: 'high', permissions: 'full-access' } });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		assert.equal(result.ok, true, result.error);
		assert.deepEqual(
			distinctPolicies(invocations),
			['high/full-access'],
			`the configured level and effort replace the defaults: ${JSON.stringify(invocations.map(({ effort, permissions }) => ({ effort, permissions })))}`,
		);
	});
});
