import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** Two exported consts in one file — a compiler-free structure finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

/** Split a multi-export file in two, which is what resolves its finding. */
const splitFile = ({ dir, file }: { dir: string; file: string }) => {
	writeSource({ dir, path: file, source: 'export const alphaThing = 1;\n' });
	writeSource({ dir, path: file.replace(/[^/]+\.ts$/, 'betaThing.ts'), source: 'export const betaThing = 2;\n' });
};

/**
 * One finding in `alpha/`, two in `beta/` — so the first batch can resolve one
 * of the second batch's two sites and leave the other standing. That is the
 * partial case: the whole-batch case skips the agent entirely, and this one
 * still has work to do.
 */
const setupSpilloverRun = async () => {
	const dir = setupConsumerRepo();

	mkdirSync(join(dir, 'alpha'), { recursive: true });
	mkdirSync(join(dir, 'beta'), { recursive: true });
	writeSource({ dir, path: 'alpha/multi.ts', source: multiExport });
	writeSource({ dir, path: 'beta/one.ts', source: multiExport });
	writeSource({ dir, path: 'beta/two.ts', source: multiExport });
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	return { dir, config: await readConfig({ cwd: dir }) };
};

describe('runRefactorPipeline against a work-list that went stale mid-run', () => {
	test('a batch is handed the sites still standing, not the ones frozen when the run began', async () => {
		const { dir, config } = await setupSpilloverRun();

		const fixPrompts: string[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				fixPrompts.push(prompt);

				// The alpha batch reaches into beta/one.ts as well — out of its own
				// scope, and enough to make the beta batch's frozen list wrong.
				const files = fixPrompts.length === 1 ? ['alpha/multi.ts', 'beta/one.ts'] : ['beta/two.ts'];

				for (const file of files) {
					splitFile({ dir, file });
				}

				return { text: report({ changedFiles: files.map((path) => ({ path, summary: 'split' })) }), exitCode: 0 };
			},
		};

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		expect(fixPrompts).toHaveLength(2);

		// The site alpha's agent already fixed is not put to beta's agent as work,
		// which would send it looking for a finding that no longer exists. (It can
		// still turn up as fresh advice about the file alpha's agent just wrote —
		// that is a live finding, not a stale one.)
		expect(fixPrompts[1]).toContain('[multi-export] beta/two.ts');
		expect(fixPrompts[1]).not.toContain('[multi-export] beta/one.ts');
		expect(result.after['multi-export'] ?? 0).toBe(0);
	});
});
