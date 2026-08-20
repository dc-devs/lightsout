import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readRunManifest } from '#src/runState/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

test('nested consumer: agent-reported repo-root-relative paths normalize to consumer-relative — no duplicate identities', async () => {
	// The consumer sits INSIDE a larger git repo (like a fixture or a
	// mono-repo subproject) — the setup where the two changed-file truths
	// historically diverged.
	const root = mkdtempSync(join(tmpdir(), 'lightsout-nested-'));
	const dir = join(root, 'consumer');

	mkdirSync(join(dir, 'src'), { recursive: true });
	writeSource({ dir, path: 'src/index.js', source: 'export const one = 1;\n' });
	writeFileSync(join(dir, 'plan.md'), '# Plan: add feature\n');
	writeFileSync(join(dir, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false } }));
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: root });

	let writerCount = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerCount += 1;
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// The agent writes the file correctly but echoes the git-ROOT-relative
			// path in its report (observed live) — git-truth says src/feature.js.
			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'consumer/src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	// one real module and the caller wiring it in — two writers, not three: the
	// repo-root-relative path the agent reported is the same file, not another
	expect(writerCount).toBe(2);

	const manifest = await readRunManifest({ cwd: dir, runId: result.manifest.runId });
	const sourceChanges = manifest.changedFiles.filter((file) => file.startsWith('src/') || file.startsWith('consumer/'));

	// one consumer-relative identity per file, no repo-root duplicate
	expect(sourceChanges).toStrictEqual(['src/feature.js', 'src/useFeature.js']);
});
