import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewOneAdvisory } from '#tests/helpers/reviewOneAdvisory.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** How many times a gate script appended to its own log — the count is what proves where in the sequence it ran. */
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
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt }) => {
				const role = roleOf(prompt);

				if (role === 'standards-review') {
					// One advisory, so the bounded cleanup loop has something to hand its
					// first round: this fixture's tree carries no qualifying deterministic
					// finding, and cleanup no longer spends a round on nothing.
					return { text: reviewOneAdvisory({ systemPrompt, path: 'src/feature.js' }), exitCode: 0 };
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
		}),
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
	// the reviewer's advisory earned the one round; the round left the tree with
	// nothing qualifying, so cleanup ended there rather than spending its budget
	expect(refactorPass).toBe(1);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.attempts).toBe(2);
	// coverage gate ran at clean-slate and both post-test verification steps
	expect(countLog(dir, 'cov.log')).toBe(3);
	// formatting ran after implementation, tests, and refactor
	expect(countLog(dir, 'fmt.log')).toBe(3);
	expect(result.manifest.steps.find((step) => step.id === 'format-implement')?.status).toBe('passed');
	expect(result.manifest.steps.find((step) => step.id === 'format-tests')?.status).toBe('passed');
	expect(result.manifest.steps.find((step) => step.id === 'format-refactor')?.status).toBe('passed');

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
	// Writer fan-out announced. The ceiling is spelled out rather than
	// interpolated from the constant: a line built from the same constant the
	// assertion reads says the same thing whatever the number is.
	expect(progress.some((line) => line.includes('4 group(s): 4 subject(s) covering 4 changed file(s), up to 10 writers in parallel'))).toBeTruthy();
	// cleanup's ending is announced, with the reason it ended
	expect(progress.some((line) => line.includes('step refactor passed — cleanup ended: clean'))).toBeTruthy();
});
