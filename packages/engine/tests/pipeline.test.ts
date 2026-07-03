import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { loadConfig, readFriction, readRunManifest, runImplementPipeline } from '../src/index';
import { report } from './helpers/report';
import { roleOf } from './helpers/roleOf';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';
import { verdict } from './helpers/verdict';

const countLog = (dir: string, file: string) => {
	try {
		return readFileSync(join(dir, file), 'utf8').length;
	} catch {
		return 0;
	}
};

test('happy path: git truth, per-file writers, refactor loop, coverage/format wiring, overview', async () => {
	const dir = setupConsumerRepo({
		scripts: {
			testCoverage: `node -e "require('fs').appendFileSync('cov.log','x')"`,
			format: `node -e "require('fs').appendFileSync('fmt.log','x')"`,
		},
	});

	writeFileSync(join(dir, 'scratch.txt'), 'pre-existing dirt\n');
	writeFileSync(join(dir, 'overview.md'), 'OVERVIEW-SENTINEL\n');

	const prompts: Record<string, string[]> = {};
	let refactorPass = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			(prompts[role] ??= []).push(prompt);

			if (role === 'write-tests') {
				const target = prompt.match(/- (\S+)/)?.[1] ?? 'unknown';
				const testFile = `test/${target.split('/').pop()?.replace('.js', '')}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub test\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				refactorPass += 1;

				if (refactorPass === 1) {
					writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 3;\n');

					return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'tidied' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement: write TWO files but report only ONE — git must catch the second.
			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');
			writeFileSync(join(dir, 'src/helper.js'), 'export const helper = () => 1;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		overviewPath: 'overview.md',
	});

	assert.equal(result.ok, true, result.error);
	assert.ok(prompts['implement']?.[0]?.includes('OVERVIEW-SENTINEL'), 'overview inlined into implement prompt');
	assert.ok(result.manifest.changedFiles.includes('src/helper.js'), 'git caught the unreported file');
	assert.ok(!result.manifest.changedFiles.includes('scratch.txt'), 'baseline dirt excluded');
	assert.ok(result.manifest.baselineDirtyFiles.includes('scratch.txt'), 'baseline recorded in manifest');
	assert.ok(
		!result.manifest.changedFiles.some((file) => file === 'cov.log' || file === 'fmt.log' || file.startsWith('.lightsout/')),
		'gate artifacts and run state never attributed',
	);
	assert.equal(prompts['write-tests']?.length, 2, 'one writer per source file');
	assert.ok(
		prompts['write-tests']?.every((prompt) => (prompt.match(/^- /gm) ?? []).length === 1),
		'each writer got exactly one file',
	);
	assert.equal(refactorPass, 2, 'refactor looped until an empty pass');
	assert.equal(result.manifest.steps.find((step) => step.id === 'refactor')?.attempts, 2);
	assert.equal(countLog(dir, 'cov.log'), 4, 'coverage gate ran at clean-slate, tests, refactor, format');
	assert.equal(countLog(dir, 'fmt.log'), 1, 'format command ran exactly once');
	assert.equal(result.manifest.steps.find((step) => step.id === 'format')?.status, 'passed');
});

test('implement that changes nothing fails instead of passing vacuously', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: report(), exitCode: 0 }) };
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'failed');
	assert.match(result.error ?? '', /nothing was implemented/);
});

test('non-git directory degrades to agent-reported files', async () => {
	const dir = setupConsumerRepo({ git: false });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.ok, true, result.error);
	assert.ok(result.manifest.changedFiles.includes('src/feature.js'));
});

test('rate-limited harness parks the run with resume instructions', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'paused-rate-limit');
	assert.ok(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`), result.error);
});

test('terminated:* report escalates instead of failing', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({
			text: report({ status: 'terminated:ambiguity', failures: ['plan does not name the target module'] }),
			exitCode: 0,
		}),
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.manifest.status, 'escalated');
	assert.match(result.error ?? '', /terminated:ambiguity/);
	assert.match(result.error ?? '', /target module/);
});

test('verify failure: cheap retries, then supervisor escalate with diagnosis', async () => {
	// testUnit is green until implement drops BROKEN; fixes never remove it.
	const dir = setupConsumerRepo({ scripts: { testUnit: 'test ! -f BROKEN' } });
	const counts: Record<string, number> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			counts[role] = (counts[role] ?? 0) + 1;

			if (role === 'supervisor') {
				return { text: verdict({ decision: 'escalate', diagnosis: 'DIAGNOSIS-SENTINEL' }), exitCode: 0 };
			}

			if (role === 'fix') {
				assert.ok(prompt.includes('# Previously changed files'), 'fix re-invocation carries changed files');

				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');
			writeFileSync(join(dir, 'BROKEN'), 'x');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.manifest.status, 'escalated');
	assert.match(result.error ?? '', /DIAGNOSIS-SENTINEL/);
	assert.equal(counts['fix'], 2, 'exactly two cheap fix retries');
	assert.equal(counts['supervisor'], 1, 'supervisor consulted exactly once');
	assert.equal(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts, 3);
});

test('supervisor retry-with-guidance heals the run', async () => {
	const dir = setupConsumerRepo({ scripts: { testUnit: 'test ! -f BROKEN' } });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'supervisor') {
				return { text: verdict({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' }), exitCode: 0 };
			}

			if (role === 'fix') {
				if (prompt.includes('Supervisor guidance')) {
					unlinkSync(join(dir, 'BROKEN'));
				}

				return { text: report(), exitCode: 0 };
			}

			if (role === 'implement') {
				writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');
				writeFileSync(join(dir, 'BROKEN'), 'x');

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.ok, true, result.error);
	assert.equal(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts, 4);
});

test('resume skips passed steps and continues attempt counts', async () => {
	const dir = setupConsumerRepo();
	const parkOnWrite: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				return { text: '', exitCode: 1, rateLimited: true };
			}

			if (role === 'implement') {
				writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};
	const config = await loadConfig({ cwd: dir });
	const parked = await runImplementPipeline({ cwd: dir, driver: parkOnWrite, config, planPath: 'plan.md' });

	assert.equal(parked.manifest.status, 'paused-rate-limit');

	const counts: Record<string, number> = {};
	const resumeDriver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			counts[role] = (counts[role] ?? 0) + 1;

			return { text: report(), exitCode: 0 };
		},
	};
	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runImplementPipeline({ cwd: dir, driver: resumeDriver, config, existing });

	assert.equal(resumed.ok, true, resumed.error);
	assert.equal(counts['implement'] ?? 0, 0, 'passed steps are not re-run');
	assert.equal(counts['write-tests'], 1, 'parked step re-runs');
	assert.equal(resumed.manifest.steps.find((step) => step.id === 'write-tests')?.attempts, 2, 'attempts continue across resume');
});

test('friction lands in friction.jsonl with run/step provenance; decisions keep their kind', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return {
				text: report({
					changedFiles: [{ path: 'src/feature.js', summary: 'feature' }],
					friction: [{ kind: 'decision', area: 'plan', detail: 'FRICTION-SENTINEL' }],
				}),
				exitCode: 0,
			};
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });
	const entries = await readFriction({ cwd: dir });
	const entry = entries.find((candidate) => candidate.detail === 'FRICTION-SENTINEL');

	assert.equal(result.ok, true, result.error);
	assert.ok(entry, 'friction entry persisted');
	assert.equal(entry?.runId, result.manifest.runId);
	assert.equal(entry?.step, 'implement');
	assert.equal(entry?.kind, 'decision');
	assert.ok(entry?.at && !Number.isNaN(Date.parse(entry.at)), 'timestamp is a valid date');
});

test('malformed agent output is retried once, then fails the step', async () => {
	const dir = setupConsumerRepo();
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: 'not a json report', exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.manifest.status, 'failed');
	assert.match(result.error ?? '', /did not match contract/);
	assert.equal(calls, 2, 'one retry after the malformed report');
});

test('write-tests aggregates per-file failures; terminated writers escalate', async () => {
	const run = async ({ failingStatus }: { failingStatus: string }) => {
		const dir = setupConsumerRepo();
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				const role = roleOf(prompt);

				if (role === 'implement') {
					writeFileSync(join(dir, 'src/a.js'), 'export const a = 1;\n');
					writeFileSync(join(dir, 'src/b.js'), 'export const b = 1;\n');

					return {
						text: report({
							changedFiles: [
								{ path: 'src/a.js', summary: 'a' },
								{ path: 'src/b.js', summary: 'b' },
							],
						}),
						exitCode: 0,
					};
				}

				if (role === 'write-tests') {
					if (prompt.includes('src/a.js')) {
						return { text: report({ status: failingStatus, failures: ['WRITER-FAILURE-SENTINEL'] }), exitCode: 0 };
					}

					return { text: report(), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		};

		return runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });
	};

	const failed = await run({ failingStatus: 'failed' });

	assert.equal(failed.manifest.status, 'failed');
	assert.match(failed.error ?? '', /src\/a\.js/);
	assert.match(failed.error ?? '', /WRITER-FAILURE-SENTINEL/);
	assert.match(failed.error ?? '', /1 of 2/);

	const terminated = await run({ failingStatus: 'terminated:scope' });

	assert.equal(terminated.manifest.status, 'escalated');
});

test('missing overview file fails the run before any agent spawns', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		overviewPath: 'missing-overview.md',
	});

	assert.equal(result.manifest.status, 'failed');
	assert.match(result.error ?? '', /overview file not found/);
});

test('--skip-refactor omits the refactor steps; absent format command is skipped', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		skipRefactor: true,
	});

	assert.equal(result.ok, true, result.error);
	assert.equal(result.manifest.steps.find((step) => step.id === 'refactor'), undefined);

	const format = result.manifest.steps.find((step) => step.id === 'format');

	assert.equal(format?.status, 'passed');
	assert.deepEqual(format?.report, { skipped: 'no format command configured' });
});
