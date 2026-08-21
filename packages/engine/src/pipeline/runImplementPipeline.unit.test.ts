import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readFriction } from '#src/runState/index.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

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
			'test-coverage': `node -e "require('fs').appendFileSync('cov.log','x')"`,
			format: `node -e "require('fs').appendFileSync('fmt.log','x')"`,
		},
	});

	writeFileSync(join(dir, 'scratch.txt'), 'pre-existing dirt\n');
	writeFileSync(join(dir, 'overview.md'), 'OVERVIEW-SENTINEL\n');

	const prompts: Record<string, string[]> = {};
	const systemPrompts: Record<string, string[]> = {};
	let refactorPass = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			prompts[role] ??= [];
			prompts[role].push(prompt);
			systemPrompts[role] ??= [];
			systemPrompts[role].push(systemPrompt ?? '');

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
					writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 3;\n' });

					return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'tidied' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement: write two JS files but report only one — git must catch
			// the second — plus a .tf that must earn no agent turns.
			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
			writeSource({ dir, path: 'src/helper.js', source: 'export const helper = () => 1;\n' });
			writeFileSync(join(dir, 'src/infra.tf'), 'resource "x" "y" {}\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.js', summary: 'feature' },
						{ path: 'src/infra.tf', summary: 'infra' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		overviewPath: 'overview.md',
		onProgress: (message) => progress.push(message),
	});

	expect(result.ok).toBe(true);
	// overview inlined into the executor system prompt
	expect(systemPrompts.implement?.[0]?.includes('OVERVIEW-SENTINEL')).toBeTruthy();
	// git caught the unreported file
	expect(result.manifest.changedFiles.includes('src/helper.js')).toBeTruthy();
	// baseline dirt excluded
	expect(result.manifest.changedFiles.includes('scratch.txt')).toBeFalsy();
	// baseline recorded in manifest
	expect(result.manifest.baselineDirtyFiles.includes('scratch.txt')).toBeTruthy();
	// gate artifacts and run state never attributed
	expect(result.manifest.changedFiles.some((file) => file === 'cov.log' || file === 'fmt.log' || file.startsWith('.lightsout/'))).toBeFalsy();
	// one writer per JS/TS file — two modules and the two callers wiring them in;
	// the .tf earned no writer
	expect(prompts['write-tests']?.length).toBe(4);
	// each writer got exactly one file — the same lone file under both the
	// subjects and must-execute headers (rules bullets carry spaces, so the
	// single-token match reads back only file bullets)
	expect(prompts['write-tests']?.every((prompt) => new Set([...prompt.matchAll(/^- (\S+)$/gm)].map((match) => match[1])).size === 1)).toBeTruthy();
	// the .tf is still tracked as changed
	expect(result.manifest.changedFiles.includes('src/infra.tf')).toBeTruthy();
	// refactor review list is JS/TS only
	expect(prompts.refactor?.[0]?.includes('src/infra.tf')).toBeFalsy();
	// refactor looped until an empty pass
	expect(refactorPass).toBe(2);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.attempts).toBe(2);
	// coverage gate ran at clean-slate, tests, refactor, format
	expect(countLog(dir, 'cov.log')).toBe(4);
	// format command ran exactly once
	expect(countLog(dir, 'fmt.log')).toBe(1);
	expect(result.manifest.steps.find((step) => step.id === 'format')?.status).toBe('passed');

	const commands = readCommandLog(dir, result.manifest.runId);
	const cleanSlateCheck = commands.find((entry) => entry.kind === 'check' && entry.step === 'clean-slate');

	// commands.jsonl written
	expect(commands.length > 0).toBeTruthy();
	// passing commands leave evidence too
	expect(cleanSlateCheck).toBeTruthy();
	expect(cleanSlateCheck?.exitCode).toBe(0);
	expect(typeof cleanSlateCheck?.durationMs).toBe('number');
	// no output tail on success
	expect(cleanSlateCheck?.outputTail).toBe(undefined);
	// format command logged
	expect(commands.some((entry) => entry.kind === 'format')).toBeTruthy();

	// config snapshot recorded in the manifest
	expect(result.manifest.config?.gates.check).toBe('true');
	// step-start progress emitted
	expect(progress.some((line) => line.startsWith('step clean-slate — attempt 1'))).toBeTruthy();
	// gate results streamed
	expect(progress.some((line) => /^gate \[root\] check: exit 0/.test(line))).toBeTruthy();
	// agent reports streamed
	expect(progress.some((line) => line.includes('step implement: agent report complete'))).toBeTruthy();
	// No consumer TypeScript in this repo → grouping degrades to one file per group.
	// writer fan-out announced
	expect(
		progress.some((line) => line.includes(`4 group(s): 4 subject(s) covering 4 changed file(s), up to ${testWriterConcurrency} writers in parallel`)),
	).toBeTruthy();
	// refactor loop end announced
	expect(progress.some((line) => line.includes('refactor pass 2: no changes — loop complete'))).toBeTruthy();
});

test('implement that changes nothing fails instead of passing vacuously', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: report(), exitCode: 0 }) };
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/nothing was implemented/);
});

test('non-git directory degrades to agent-reported files', async () => {
	const dir = setupConsumerRepo({ git: false });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	expect(result.manifest.changedFiles.includes('src/feature.js')).toBeTruthy();
});

test('friction lands in friction.jsonl with run/step provenance; decisions keep their kind', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return {
				text: report({
					changedFiles: [{ path: 'src/feature.js', summary: 'feature' }],
					friction: [{ kind: 'decision', area: 'plan', detail: 'FRICTION-SENTINEL' }],
				}),
				exitCode: 0,
			};
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });
	const entries = await readFriction({ cwd: dir });
	const entry = entries.find((candidate) => candidate.detail === 'FRICTION-SENTINEL');

	expect(result.ok).toBe(true);
	// friction entry persisted
	expect(entry).toBeTruthy();
	expect(entry?.runId).toBe(result.manifest.runId);
	expect(entry?.step).toBe('implement');
	expect(entry?.kind).toBe('decision');
	// timestamp is a valid date
	expect(entry?.at && !Number.isNaN(Date.parse(entry.at))).toBeTruthy();
});

test('config timeouts reach the driver; defaults are 60m agent / 15m supervisor', async () => {
	const run = async ({ config }: { config: Record<string, unknown> }) => {
		const dir = setupConsumerRepo({ config });
		let received: number | undefined;
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ timeoutMs }) => {
				received ??= timeoutMs;

				return { text: report({ status: 'failed', failures: ['stop early'] }), exitCode: 0 };
			},
		};

		await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

		return received;
	};

	// default agent ceiling is 60 minutes
	expect(await run({ config: {} })).toBe(60 * 60_000);
	// configured ceiling reaches the driver
	expect(await run({ config: { timeouts: { 'agent-minutes': 33 } } })).toBe(33 * 60_000);
});

test('missing plan file fails the run before any agent spawns', async () => {
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
		config: await readConfig({ cwd: dir }),
		planPath: 'ghost.md',
	});

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/plan file not found: .*ghost\.md/);
});

test('a change with no testable source skips both write-tests and refactor, and still passes', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			// The only change is a doc — real changed-file truth, but nothing a
			// test writer or refactorer can act on.
			writeFileSync(join(dir, 'docs.md'), '# docs\n');

			return { text: report({ changedFiles: [{ path: 'docs.md', summary: 'docs' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	// the doc change is still attributed
	expect(result.manifest.changedFiles.includes('docs.md')).toBeTruthy();

	const stepReport = (id: string) => result.manifest.steps.find((step) => step.id === id)?.report;

	expect(stepReport('write-tests')).toStrictEqual({ skipped: 'no eligible source files' });
	expect(stepReport('refactor')).toStrictEqual({ skipped: 'no changed source files to review' });
	// the verify after a skipped refactor still runs
	expect(result.manifest.steps.find((step) => step.id === 'verify-refactor')?.status).toBe('passed');
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
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		overviewPath: 'missing-overview.md',
	});

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/overview file not found/);
});

test('--skip-refactor omits the refactor steps; absent format command is skipped', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		skipRefactor: true,
	});

	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')).toBe(undefined);

	const format = result.manifest.steps.find((step) => step.id === 'format');

	expect(format?.status).toBe('passed');
	expect(format?.report).toStrictEqual({ skipped: 'no format command configured' });
});

test('a run started with no plan path at all fails before any agent spawns', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	// an omitted plan path is recorded as the empty path it is and read back as
	// a missing plan — never as an empty plan the agents would work from
	expect(result.manifest.plan).toBe('');
	expect(result.error ?? '').toMatch(/plan file not found/);
});
