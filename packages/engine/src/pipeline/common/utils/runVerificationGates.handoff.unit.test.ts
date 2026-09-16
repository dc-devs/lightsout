import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PlanningHandoff } from '#src/contracts/index.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { createRun } from '#src/runState/index.ts';
import { gateResultsCommand } from '#tests/helpers/gateResultsCommand.ts';
import { setupMonorepo } from '#tests/helpers/setupMonorepo.ts';

const setup = async ({ root }: { root: boolean }) => {
	const cwd = setupMonorepo();
	const config = await readConfig({ cwd });
	const rows = ['packages/api/src/first.unit.test.ts', 'packages/web/src/second.unit.test.ts', ...(root ? ['src/root.unit.test.ts'] : [])].map((testFile) => ({
		testFile,
		testName: 'retains completion',
		gate: 'test',
	}));
	const command = gateResultsCommand({ tests: rows.map((row) => ({ file: row.testFile, name: row.testName })) });
	config.gates = { check: 'true', test: command, 'test-coverage': false };
	config['package-gates'] = { check: 'true', test: `${command} {package}` };
	const planningHandoff = PlanningHandoff.parse({ format: 'planning-handoff-v1', name: 'retry', generation: 'a'.repeat(64), phases: [] });
	const manifest = await createRun({ cwd, config, plan: 'plan.md', driver: 'stub', planningHandoff });
	const run = new PipelineRun({
		cwd,
		config,
		manifest: { ...manifest, packages: ['web'] },
		driver: {
			name: 'stub',
			invoke: async () => {
				throw new Error('No model allowed');
			},
		},
	});
	return { run, rows };
};

test.each([false, true])('a later canonical phase proves inherited acceptance, including root: %s', async (root) => {
	const fixture = await setup({ root });
	const result = await runVerificationGates({ ...fixture, checkpoint: 'verify-tests', coverage: false, final: true });
	expect(result.error).toBeUndefined();
	expect(
		result.gates
			?.filter((gate) => gate.kind === 'test')
			.map((gate) => gate.group)
			.sort(),
	).toStrictEqual(root ? ['root'] : ['api', 'web']);
});
