import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Driver } from '#src/drivers/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';

/**
 * A stub harness that implements each phase for real (a source file per phase,
 * a test file per source file) and pushes the phase number it was handed onto
 * `seen`. `failAt` returns a failed report for that phase; `parkAt` reports a
 * rate limit instead. The commit-message agent answers off contract, so a
 * phase's commit keeps its template subject.
 */
export const createPhaseDriver = ({
	dir,
	seen,
	failAt,
	parkAt,
	usage,
}: {
	dir: string;
	seen: number[];
	failAt?: number;
	parkAt?: number;
	usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number };
}): Driver => ({
	name: 'stub',
	invoke: withTestChangeReview({
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			// Prose the commit-message contract refuses, so every phase commits under
			// its template subject — the one that names the phase. Read from the system
			// prompt as well, because the re-emit rung keeps the role's system prompt
			// but not its task heading.
			if (role === 'commit-message' || systemPrompt?.startsWith('# Role: Commit Message Writer')) {
				return { text: 'The phase is committed.', exitCode: 0 };
			}

			if (role === 'write-tests') {
				const target = /- (\S+)/.exec(prompt)?.[1] ?? 'unknown.js';
				const testFile = `test/${basename(target, '.js')}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub test\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0, usage };
			}

			if (role !== 'implement') {
				return { text: report(), exitCode: 0, usage };
			}

			const phase = Number(/PHASE-(\d+)-SENTINEL/.exec(systemPrompt ?? '')?.[1] ?? 0);

			seen.push(phase);

			if (phase === parkAt) {
				return { text: '', exitCode: 1, rateLimited: true };
			}

			if (phase === failAt) {
				return { text: report({ status: 'failed', failures: [`PHASE-${phase}-FAILURE`] }), exitCode: 0, usage };
			}

			writeFileSync(join(dir, `src/phase${phase}.js`), `export const phase${phase} = ${phase};\n`);

			return { text: report({ changedFiles: [{ path: `src/phase${phase}.js`, summary: 'feature' }] }), exitCode: 0, usage };
		},
	}),
});
