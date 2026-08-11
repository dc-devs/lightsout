import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { verdict } from '@tests/helpers/verdict';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';
import { readFriction, readRunManifest } from '@/runState';

const countLog = (dir: string, file: string) => {
	try {
		return readFileSync(join(dir, file), 'utf8').length;
	} catch {
		return 0;
	}
};

const readCommandLog = (dir: string, runId: string): Record<string, unknown>[] => {
	try {
		return readFileSync(join(dir, '.lightsout', 'runs', runId, 'commands.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
	} catch {
		return [];
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
					writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 3;\n');

					return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'tidied' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement: write two JS files but report only one — git must catch
			// the second — plus a .tf that must earn no agent turns.
			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');
			writeFileSync(join(dir, 'src/helper.js'), 'export const helper = () => 1;\n');
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
		config: await loadConfig({ cwd: dir }),
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
	// one writer per JS/TS file — the .tf earned no writer
	expect(prompts['write-tests']?.length).toBe(2);
	// each writer got exactly one file in its target list
	expect(prompts['write-tests']?.every((prompt) => (prompt.match(/^- /gm) ?? []).length === 1)).toBeTruthy();
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
	expect(result.manifest.config?.scripts.check).toBe('true');
	// step-start progress emitted
	expect(progress.some((line) => line.startsWith('step clean-slate — attempt 1'))).toBeTruthy();
	// gate results streamed
	expect(progress.some((line) => /^gate \[root\] check: exit 0/.test(line))).toBeTruthy();
	// agent reports streamed
	expect(progress.some((line) => line.includes('step implement: agent report complete'))).toBeTruthy();
	// No consumer TypeScript in this repo → grouping degrades to one file per group.
	// writer fan-out announced
	expect(progress.some((line) => line.includes('2 group(s) across 2 file(s) (import-graph), up to 5 writers in parallel'))).toBeTruthy();
	// refactor loop end announced
	expect(progress.some((line) => line.includes('refactor pass 2: no changes — loop complete'))).toBeTruthy();
});

test('standards gate: findings feed the refactor prompt; a fixing pass clears the gate', async () => {
	const dir = setupConsumerRepo();
	const prompts: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/messy.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/messy.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				prompts.push(prompt);

				// First pass fixes the planted multi-export; later passes are clean.
				// The fixed file exports nothing at all, so no advisory (a filename
				// mismatch, an unconsumed export) survives to keep the section alive.
				if (prompts.length === 1) {
					writeFileSync(join(dir, 'src/messy.js'), "import { one } from './index.js';\n\nconsole.log(one);\n");

					return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'split exports' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement plants a multi-export violation — the standards gate's target.
			writeFileSync(join(dir, 'src/messy.js'), 'export const first = () => 1;\nexport const second = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	expect(result.ok).toBe(true);
	// gate narrated the finding — the work-list count IS the blocking count now,
	// so there is no second number to print
	expect(progress.some((line) => line.startsWith('standards gate: 1 blocking'))).toBeTruthy();
	// findings section injected into the refactor prompt
	expect(prompts[0]?.includes('# Standards findings')).toBeTruthy();
	// the planted violation named in the work-list
	expect(prompts[0]?.includes('[multi-export] src/messy.js')).toBeTruthy();
	// clean tree injects no findings section
	expect(prompts[1]?.includes('# Standards findings')).toBeFalsy();
});

test('standards gate: two identical declined passes escalate early — the third pass is never bought', async () => {
	const dir = setupConsumerRepo();
	let refactorInvocations = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/messy.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/messy.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				refactorInvocations += 1;

				// Reports clean without ever fixing the violation, and explains why.
				return {
					text: report({ friction: [{ kind: 'decision', area: 'plan', detail: 'finding kept: the split would break the public API' }] }),
					exitCode: 0,
				};
			}

			writeFileSync(join(dir, 'src/messy.js'), 'export const first = () => 1;\nexport const second = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// the second identical decline settles it — no third invocation
	expect(refactorInvocations).toBe(2);
	expect(result.error ?? '').toMatch(/standards gate — 1 blocking persist after 2 pass\(es\)/);
	expect(result.error ?? '').toMatch(/multi-export:src\/messy\.js/);
	// The escalation carries the evidence a human needs: the finding's detail
	// with its location, and the agent's own account of why it was left.
	expect(result.error ?? '').toMatch(/at src\/messy\.js/);
	expect(result.error ?? '').toMatch(/the refactor agent's account of its final pass:/);
	expect(result.error ?? '').toMatch(/finding kept: the split would break the public API/);
});

test('standards gate: a declined pass that still CHANGED the gating set earns the next pass', async () => {
	const dir = setupConsumerRepo();
	let refactorInvocations = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				const target = prompt.match(/- (\S+)/)?.[1] ?? 'unknown';
				const testFile = `test/${target.split('/').pop()?.replace('.js', '')}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				refactorInvocations += 1;

				// Pass 1 quietly fixes one of the two violations ON DISK while
				// reporting zero changes — the gating set shrinks, so the
				// early-exit must NOT fire; passes 2 and 3 decline identically.
				if (refactorInvocations === 1) {
					writeFileSync(join(dir, 'src/alpha.js'), 'export const first = () => 1;\n');
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement plants two violations in two files (two distinct clusters).
			writeFileSync(join(dir, 'src/alpha.js'), 'export const first = () => 1;\nexport const second = () => 2;\n');
			writeFileSync(join(dir, 'src/beta.js'), 'export const third = () => 3;\nexport const fourth = () => 4;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/alpha.js', summary: 'feature' },
						{ path: 'src/beta.js', summary: 'feature' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// a shrinking gating set is progress — the full pass budget stays available
	expect(refactorInvocations).toBe(3);
	expect(result.error ?? '').toMatch(/persist after 3 pass\(es\)/);
	expect(result.error ?? '').toMatch(/multi-export:src\/beta\.js/);
	// the quietly-fixed violation is gone from the escalation
	expect(result.error ?? '').not.toMatch(/multi-export:src\/alpha\.js/);
});

test('implement that changes nothing fails instead of passing vacuously', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: report(), exitCode: 0 }) };
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

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

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	expect(result.manifest.changedFiles.includes('src/feature.js')).toBeTruthy();
});

test('rate-limited harness parks the run with resume instructions', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
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

	expect(result.manifest.status).toBe('escalated');
	expect(result.error ?? '').toMatch(/terminated:ambiguity/);
	expect(result.error ?? '').toMatch(/target module/);
});

test('verify failure: cheap retries, then supervisor escalate with diagnosis', async () => {
	// testUnit is green until implement drops BROKEN; fixes never remove it.
	const dir = setupConsumerRepo({ scripts: { testUnit: 'test ! -f BROKEN' } });
	const counts: Record<string, number> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			counts[role] = (counts[role] ?? 0) + 1;

			if (role === 'supervisor') {
				return { text: verdict({ decision: 'escalate', diagnosis: 'DIAGNOSIS-SENTINEL' }), exitCode: 0 };
			}

			if (role === 'fix') {
				// fix re-invocation carries changed files
				expect(prompt.includes('# Previously changed files')).toBeTruthy();

				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');
			writeFileSync(join(dir, 'BROKEN'), 'x');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	expect(result.error ?? '').toMatch(/DIAGNOSIS-SENTINEL/);
	// exactly two cheap fix retries
	expect(counts.fix).toBe(2);
	// supervisor consulted exactly once
	expect(counts.supervisor).toBe(1);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(3);

	const failed = readCommandLog(dir, result.manifest.runId).find((entry) => entry.kind === 'testUnit' && entry.exitCode !== 0);

	// failing command logged
	expect(failed).toBeTruthy();
	// failure carries an output tail
	expect(typeof failed?.outputTail).toBe('string');
});

test('supervisor retry-with-guidance heals the run', async () => {
	const dir = setupConsumerRepo({ scripts: { testUnit: 'test ! -f BROKEN' } });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

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

	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(4);
});

test('resume skips passed steps and continues attempt counts', async () => {
	const dir = setupConsumerRepo();
	const parkOnWrite: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

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

	expect(parked.manifest.status).toBe('paused-rate-limit');

	const counts: Record<string, number> = {};
	const resumeDriver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			counts[role] = (counts[role] ?? 0) + 1;

			return { text: report(), exitCode: 0 };
		},
	};
	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runImplementPipeline({ cwd: dir, driver: resumeDriver, config, existing });

	expect(resumed.ok).toBe(true);
	// passed steps are not re-run
	expect(counts.implement ?? 0).toBe(0);
	// parked step re-runs
	expect(counts['write-tests']).toBe(1);
	// attempts continue across resume
	expect(resumed.manifest.steps.find((step) => step.id === 'write-tests')?.attempts).toBe(2);
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

	expect(result.ok).toBe(true);
	// friction entry persisted
	expect(entry).toBeTruthy();
	expect(entry?.runId).toBe(result.manifest.runId);
	expect(entry?.step).toBe('implement');
	expect(entry?.kind).toBe('decision');
	// timestamp is a valid date
	expect(entry?.at && !Number.isNaN(Date.parse(entry.at))).toBeTruthy();
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

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/did not match contract/);
	// one retry after the malformed report
	expect(calls).toBe(2);
});

test('write-tests aggregates per-file failures; terminated writers escalate', async () => {
	const run = async ({ failingStatus }: { failingStatus: string }) => {
		const dir = setupConsumerRepo();
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				const role = roleOf(prompt);

				if (role === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

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

	expect(failed.manifest.status).toBe('failed');
	expect(failed.error ?? '').toMatch(/src\/a\.js/);
	expect(failed.error ?? '').toMatch(/WRITER-FAILURE-SENTINEL/);
	expect(failed.error ?? '').toMatch(/1 of 2/);

	const terminated = await run({ failingStatus: 'terminated:scope' });

	expect(terminated.manifest.status).toBe('escalated');
});

test('a driver exception (timeout, spawn failure) is a recorded failure, never a zombie', async () => {
	const dir = setupConsumerRepo();
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;
			throw new Error('claude timed out after 3600000ms');
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });
	const persisted = await readRunManifest({ cwd: dir, runId: result.manifest.runId });

	expect(result.ok).toBe(false);
	// manifest records the failure — no running zombie
	expect(persisted.status).toBe('failed');
	expect(result.error ?? '').toMatch(/agent invocation failed.*timed out/);
	// no blind retry after a timeout
	expect(calls).toBe(1);
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

		await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

		return received;
	};

	// default agent ceiling is 60 minutes
	expect(await run({ config: {} })).toBe(60 * 60_000);
	// configured ceiling reaches the driver
	expect(await run({ config: { timeouts: { agentMinutes: 33 } } })).toBe(33 * 60_000);
});

test('generate runs first in every gate set; generated prefixes earn no attribution or agent turns', async () => {
	const dir = setupConsumerRepo({
		scripts: {
			// Simulate codegen: every run rewrites a derived .ts file and logs.
			generate: `node -e "const fs=require('fs');fs.mkdirSync('src/gen',{recursive:true});fs.writeFileSync('src/gen/model.ts','export const gen = '+Date.now()+';');fs.appendFileSync('gen.log','x')"`,
		},
		config: { generated: ['src/gen/'] },
	});
	const writers: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writers.push(prompt.match(/- (\S+)/)?.[1] ?? 'unknown');
			}

			if (role !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.js', summary: 'feature' },
						{ path: 'src/gen/model.ts', summary: 'agent even reported a generated file' },
					],
				}),
				exitCode: 0,
			};
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });
	const commands = readCommandLog(dir, result.manifest.runId);

	expect(result.ok).toBe(true);
	// generated file never attributed — even agent-reported
	expect(result.manifest.changedFiles.includes('src/gen/model.ts')).toBeFalsy();
	// no writer spawned for the generated .ts
	expect(writers).toStrictEqual(['src/feature.js']);
	// generate is the first command of the first gate set
	expect(commands[0]?.kind).toBe('generate');
	// generate ran once per gate set (clean-slate + 3 verifies; no format
	// configured)
	expect(countLog(dir, 'gen.log')).toBe(4);
	// every check is preceded by a generate
	expect(commands.every((entry, index) => entry.kind !== 'check' || commands.slice(0, index).some((prior) => prior.kind === 'generate'))).toBeTruthy();
});

test('standards default on when unspecified; false switches them off explicitly', async () => {
	const run = async ({ config }: { config: Record<string, unknown> }) => {
		const dir = setupConsumerRepo({ config });
		let implementPrompt = '';
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt, systemPrompt }) => {
				if (roleOf(prompt) === 'implement') {
					// Standards ride the system prompt — stable for the run, so cached.
					implementPrompt = systemPrompt ?? '';

					return { text: report({ status: 'failed', failures: ['stop early'] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		};

		await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

		return implementPrompt;
	};

	const defaulted = await run({ config: {} });

	// unspecified → standards section present
	expect(defaulted.includes('# Standards\n\nThese rules are binding')).toBeTruthy();
	// bundled defaults inlined
	expect(defaulted.includes('One Export Per File')).toBeTruthy();

	const disabled = await run({ config: { standardsPackages: false } });

	// false → no standards section
	expect(disabled.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
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
		config: await loadConfig({ cwd: dir }),
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
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

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
		config: await loadConfig({ cwd: dir }),
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

	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')).toBe(undefined);

	const format = result.manifest.steps.find((step) => step.id === 'format');

	expect(format?.status).toBe('passed');
	expect(format?.report).toStrictEqual({ skipped: 'no format command configured' });
});
