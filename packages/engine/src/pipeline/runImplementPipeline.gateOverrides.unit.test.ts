import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * Three green gates that do nothing but append "root <kind>" to gates.log —
 * two cheap ones and one expensive build.
 *
 * Which gates a checkpoint scheduled, and in which order, is then readable off
 * that log once the run is over. It is the only place the checkpoint id a step
 * threads becomes observable from outside: a step naming the wrong checkpoint
 * schedules the wrong gates, and nothing else about the run changes.
 */
const loggingGates = {
	check: `${gateLogCommand({ kind: 'check' })} root`,
	test: `${gateLogCommand({ kind: 'test' })} root`,
	build: `${gateLogCommand({ kind: 'build' })} root`,
};

interface Params {
	/** Merged over the three logging gates — a case that needs one of them red writes it here. */
	scripts?: Record<string, string | false>;
	/** The repo's `gate-overrides` block. Empty is the same as no block: every checkpoint keeps the engine's default schedule. */
	overrides?: Record<string, 'off' | string[]>;
}

/**
 * A consumer repo carrying those gates and the `gate-overrides` block the case
 * is about, driven by a stub that implements one source file and drops one stub
 * test per writer — enough work for the run to reach every checkpoint.
 */
const setupOverrideRun = async ({ scripts, overrides }: Params = {}) => {
	const dir = setupConsumerRepo({ scripts: { ...loggingGates, ...scripts }, config: { 'gate-overrides': overrides ?? {} } });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await readConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test('gate-overrides: clean-slate runs the gates its own key names, and the verify checkpoints keep the engine default', async () => {
		const { dir, driver, config } = await setupOverrideRun({ overrides: { 'clean-slate': ['build'] } });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(true);
		// the build alone at clean-slate, because that checkpoint is the one the
		// override names; both verify checkpoints are unlisted, so each keeps the
		// default — the cheap gates first, the expensive one behind them
		expect(readGateLog({ dir })).toStrictEqual(['root build', 'root check', 'root test', 'root build', 'root check', 'root test', 'root build']);
	});

	test('gate-overrides: each verify checkpoint reads its own key — one runs a named list, the next runs nothing', async () => {
		const { dir, driver, config } = await setupOverrideRun({ overrides: { 'verify-implement': ['check'], 'verify-tests': 'off' } });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(true);
		// clean-slate is unlisted and keeps the default, verify-implement runs the
		// one gate its key names, and verify-tests runs none at all — three
		// different schedules a step threading one fixed checkpoint name could not
		// produce
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root test', 'root build', 'root check']);
	});

	test('a red cheap gate at clean-slate holds the expensive tier, so the build never runs at that checkpoint', async () => {
		const { dir, driver, config } = await setupOverrideRun({ scripts: { check: 'echo RED-CHECK >&2; exit 1' } });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(false);
		expect(result.error ?? '').toMatch(/RED-CHECK/);
		// the unit suite still ran behind the red check, so one report carries every
		// cheap failure — and the build was never paid for
		expect(readGateLog({ dir })).toStrictEqual(['root test']);
	});
});
