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

	assert.equal(result.ok, true, result.error);
	assert.ok(prompts['implement']?.[0]?.includes('OVERVIEW-SENTINEL'), 'overview inlined into implement prompt');
	assert.ok(result.manifest.changedFiles.includes('src/helper.js'), 'git caught the unreported file');
	assert.ok(!result.manifest.changedFiles.includes('scratch.txt'), 'baseline dirt excluded');
	assert.ok(result.manifest.baselineDirtyFiles.includes('scratch.txt'), 'baseline recorded in manifest');
	assert.ok(
		!result.manifest.changedFiles.some((file) => file === 'cov.log' || file === 'fmt.log' || file.startsWith('.lightsout/')),
		'gate artifacts and run state never attributed',
	);
	assert.equal(prompts['write-tests']?.length, 2, 'one writer per JS/TS file — the .tf earned no writer');
	assert.ok(
		prompts['write-tests']?.every((prompt) => (prompt.split('# Plan')[0]?.match(/^- /gm) ?? []).length === 1),
		'each writer got exactly one file in its target list',
	);
	assert.ok(result.manifest.changedFiles.includes('src/infra.tf'), 'the .tf is still tracked as changed');
	assert.ok(!prompts['refactor']?.[0]?.includes('src/infra.tf'), 'refactor review list is JS/TS only');
	assert.equal(refactorPass, 2, 'refactor looped until an empty pass');
	assert.equal(result.manifest.steps.find((step) => step.id === 'refactor')?.attempts, 2);
	assert.equal(countLog(dir, 'cov.log'), 4, 'coverage gate ran at clean-slate, tests, refactor, format');
	assert.equal(countLog(dir, 'fmt.log'), 1, 'format command ran exactly once');
	assert.equal(result.manifest.steps.find((step) => step.id === 'format')?.status, 'passed');

	const commands = readCommandLog(dir, result.manifest.runId);
	const cleanSlateCheck = commands.find((entry) => entry['kind'] === 'check' && entry['step'] === 'clean-slate');

	assert.ok(commands.length > 0, 'commands.jsonl written');
	assert.ok(cleanSlateCheck, 'passing commands leave evidence too');
	assert.equal(cleanSlateCheck?.['exitCode'], 0);
	assert.equal(typeof cleanSlateCheck?.['durationMs'], 'number');
	assert.equal(cleanSlateCheck?.['outputTail'], undefined, 'no output tail on success');
	assert.ok(commands.some((entry) => entry['kind'] === 'format'), 'format command logged');

	assert.equal(result.manifest.config?.scripts.check, 'true', 'config snapshot recorded in the manifest');
	assert.ok(progress.some((line) => line.startsWith('step clean-slate — attempt 1')), 'step-start progress emitted');
	assert.ok(progress.some((line) => /^gate \[root\] check: exit 0/.test(line)), 'gate results streamed');
	assert.ok(progress.some((line) => line.includes('step implement: agent report complete')), 'agent reports streamed');
	// No consumer TypeScript in this repo → grouping degrades to one file per group.
	assert.ok(progress.some((line) => line.includes('2 group(s) across 2 file(s) (import-graph), up to 5 writers in parallel')), 'writer fan-out announced');
	assert.ok(progress.some((line) => line.includes('refactor pass 2: no changes — loop complete')), 'refactor loop end announced');
});

test('scan gate: findings feed the refactor prompt; a fixing pass clears the gate', async () => {
	const dir = setupConsumerRepo();
	const prompts: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/messy.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/messy.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				prompts.push(prompt);

				// First pass fixes the planted multi-export; later passes are clean.
				if (prompts.length === 1) {
					writeFileSync(join(dir, 'src/messy.js'), 'export const first = () => 1;\n');

					return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'split exports' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement plants a multi-export violation — the scan gate's target.
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

	assert.equal(result.ok, true, result.error);
	assert.ok(progress.some((line) => line.includes('scan gate: 1 finding(s)') && line.includes('1 gating')), 'gate narrated the finding');
	assert.ok(prompts[0]?.includes('# Scan findings'), 'findings section injected into the refactor prompt');
	assert.ok(prompts[0]?.includes('[structure] src/messy.js'), 'the planted violation named in the work-list');
	assert.ok(!prompts[1]?.includes('# Scan findings'), 'clean tree injects no findings section');
});

test('scan gate: two identical declined passes escalate early — the third pass is never bought', async () => {
	const dir = setupConsumerRepo();
	let refactorInvocations = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

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

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'escalated');
	assert.equal(refactorInvocations, 2, 'the second identical decline settles it — no third invocation');
	assert.match(result.error ?? '', /scan gate — 1 finding\(s\) persist after 2 pass\(es\)/);
	assert.match(result.error ?? '', /multi-export:src\/messy\.js/);
	// The escalation carries the evidence a human needs: the finding's detail
	// with its location, and the agent's own account of why it was left.
	assert.match(result.error ?? '', /at src\/messy\.js/);
	assert.match(result.error ?? '', /the refactor agent's account of its final pass:/);
	assert.match(result.error ?? '', /finding kept: the split would break the public API/);
});

test('scan gate: a declined pass that still CHANGED the gating set earns the next pass', async () => {
	const dir = setupConsumerRepo();
	let refactorInvocations = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

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

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'escalated');
	assert.equal(refactorInvocations, 3, 'a shrinking gating set is progress — the full pass budget stays available');
	assert.match(result.error ?? '', /persist after 3 pass\(es\)/);
	assert.match(result.error ?? '', /multi-export:src\/beta\.js/);
	assert.doesNotMatch(result.error ?? '', /multi-export:src\/alpha\.js/, 'the quietly-fixed violation is gone from the escalation');
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

	const failed = readCommandLog(dir, result.manifest.runId).find(
		(entry) => entry['kind'] === 'testUnit' && entry['exitCode'] !== 0,
	);

	assert.ok(failed, 'failing command logged');
	assert.equal(typeof failed?.['outputTail'], 'string', 'failure carries an output tail');
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

	assert.equal(result.ok, false);
	assert.equal(persisted.status, 'failed', 'manifest records the failure — no running zombie');
	assert.match(result.error ?? '', /agent invocation failed.*timed out/);
	assert.equal(calls, 1, 'no blind retry after a timeout');
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

	assert.equal(await run({ config: {} }), 60 * 60_000, 'default agent ceiling is 60 minutes');
	assert.equal(await run({ config: { timeouts: { agentMinutes: 33 } } }), 33 * 60_000, 'configured ceiling reaches the driver');
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

	assert.equal(result.ok, true, result.error);
	assert.ok(!result.manifest.changedFiles.includes('src/gen/model.ts'), 'generated file never attributed — even agent-reported');
	assert.deepEqual(writers, ['src/feature.js'], 'no writer spawned for the generated .ts');
	assert.equal(commands[0]?.['kind'], 'generate', 'generate is the first command of the first gate set');
	assert.equal(countLog(dir, 'gen.log'), 4, 'generate ran once per gate set (clean-slate + 3 verifies; no format configured)');
	assert.ok(
		commands.every((entry, index) => entry['kind'] !== 'check' || commands.slice(0, index).some((prior) => prior['kind'] === 'generate')),
		'every check is preceded by a generate',
	);
});

test('standards default on when unspecified; false switches them off explicitly', async () => {
	const run = async ({ config }: { config: Record<string, unknown> }) => {
		const dir = setupConsumerRepo({ config });
		let implementPrompt = '';
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'implement') {
					implementPrompt = prompt;

					return { text: report({ status: 'failed', failures: ['stop early'] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		};

		await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

		return implementPrompt;
	};

	const defaulted = await run({ config: {} });

	assert.ok(defaulted.includes('# Standards'), 'unspecified → standards section present');
	assert.ok(defaulted.includes('One Export Per File'), 'bundled defaults inlined');

	const disabled = await run({ config: { standards: false, testStandards: false } });

	assert.ok(!disabled.includes('# Standards'), 'false → no standards section');
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
