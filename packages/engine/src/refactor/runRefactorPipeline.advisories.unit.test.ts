import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';
import { readRunManifest } from '#src/runState/index.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// Advisories ride each batch as context for the executor — recomputed live,
// carrying their own guidance, scoped to the batch's own files.

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

test('refactor: advisories are recomputed at batch time, not served stale from the frozen worklist', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });
	mkdirSync(join(dir, 'alpha'), { recursive: true });

	// The finding file ALSO carries a size advisory (an over-cap function), so
	// the advisory rides the batch as context for the same file.
	const bigFunction = `export const big = () => {\n${Array.from({ length: 85 }, (_, index) => `\tconst v${index} = ${index};`).join('\n')}\n\treturn v0;\n};\n`;

	writeSource({ dir, path: 'alpha/multi.ts', source: `export const alpha = 1;\n${bigFunction}` });
	commitAll(dir);

	let calls = 0;
	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			calls += 1;

			if (calls === 1) {
				return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
			}

			prompts.push(prompt);
			writeSource({ dir, path: 'alpha/multi.ts', source: 'export const alpha = 1;\n' });
			writeSource({ dir, path: 'alpha/beta.ts', source: 'export const beta = 2;\n' });

			return {
				text: report({
					changedFiles: [
						{ path: 'alpha/multi.ts', summary: 'split' },
						{ path: 'alpha/beta.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const config = await readConfig({ cwd: dir });
	const parked = await runRefactorPipeline({ cwd: dir, driver, config });

	expect(parked.manifest.status).toBe('paused-rate-limit');

	// Between park and resume, the advisory's location shifts — the frozen
	// worklist now cites stale lines.
	writeSource({ dir, path: 'alpha/multi.ts', source: `${'// shift\n'.repeat(10)}export const alpha = 1;\n${bigFunction}` });

	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runRefactorPipeline({ cwd: dir, driver, config, existing });

	expect(resumed.ok).toBe(true);
	// the advisory in the prompt cites the LIVE line (12), not the frozen one (2)
	// — got:\n${prompts[0]?.split('\n').filter((line) =>
	// line.includes('[size-function]')).join('\n')}
	expect(prompts[0]?.includes('alpha/multi.ts:12')).toBeTruthy();
});

test('refactor: every advisory on the batch’s files rides the executor prompt, not only the size ones', async () => {
	const dir = setupConsumerRepo();

	mkdirSync(join(dir, 'alpha'), { recursive: true });
	mkdirSync(join(dir, 'beta'), { recursive: true });

	// Each file carries a multi-export FINDING. alpha's is also half of a
	// near-identical pair, so it carries a duplicate-block ADVISORY too — a rule outside the
	// size family. Distinct filenames keep the name rules from producing an
	// advisory that spans both folders.
	const cloned = (name: string) => `export const ${name} = (): number => {\n${'\tconst padding = 1;\n'.repeat(60)}\treturn 1;\n};\n`;

	// the duplicated span sits in widget.ts itself, so the advisory lands on a file the
	// batch owns — an advisory on some other file belongs to some other batch
	writeSource({ dir, path: 'alpha/widget.ts', source: `export const alphaThing = 1;\n${cloned('betaThing')}` });
	writeSource({ dir, path: 'alpha/widgetCopy.ts', source: cloned('widgetCopy') });
	writeSource({ dir, path: 'beta/gadget.ts', source: 'export const gammaThing = 3;\nexport const deltaThing = 4;\n' });
	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			prompts.push(prompt);

			return { text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'left as-is: exempt by design' }] }), exitCode: 0 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(true);

	const advisorySection = prompts.find((prompt) => prompt.includes('alpha/widget.ts'))?.split('Advisory —')[1] ?? '';

	// a duplicate-block advisory is not a size advisory, and an advisory the agent
	// never sees is one it can never judge:\n${advisorySection}
	expect(advisorySection.includes('[duplicate-code-block] alpha/widget.ts')).toBeTruthy();
	// its own guidance rides with it — each advisory rule asks for something
	// different, so a blanket instruction cannot stand in for it
	expect(advisorySection.includes('Extract the shared block, or say why the copies have to differ.')).toBeTruthy();
	// and only the batch's own files: beta's advisory belongs to beta's batch
	expect(advisorySection.includes('beta/gadget.ts')).toBeFalsy();
});
