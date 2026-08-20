import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { collectBatchChanges } from '#src/common/utils/collectBatchChanges.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

describe('collectBatchChanges', () => {
	test('unions what the agent reported with what git saw', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, 'src/untold.ts'), 'export const untold = 1;\n');

		const changed = await collectBatchChanges({ cwd, config, reportedFiles: new Set(['src/reported.ts']), attributedFiles: [] });

		// agents can forget a file; git cannot be sweet-talked
		expect(changed.sort()).toStrictEqual(['src/reported.ts', 'src/untold.ts']);
	});

	test('a file the agent reported and git also saw is listed once', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, 'src/both.ts'), 'export const both = 1;\n');

		const changed = await collectBatchChanges({ cwd, config, reportedFiles: new Set(['src/both.ts']), attributedFiles: [] });

		// the two truths agree far more often than they differ — agreement must not
		// inflate the count downstream steps read as the batch's size
		expect(changed).toStrictEqual(['src/both.ts']);
	});

	test('drops files an earlier step already claimed, so a batch is not credited twice', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, 'src/earlier.ts'), 'export const earlier = 1;\n');

		const changed = await collectBatchChanges({ cwd, config, reportedFiles: new Set(), attributedFiles: ['src/earlier.ts'] });

		expect(changed).toStrictEqual([]);
	});

	test('drops generated paths, which are artifacts rather than the change itself', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, 'src/client.gen.ts'), 'export const generated = 1;\n');

		const changed = await collectBatchChanges({ cwd, config: { ...config, generated: ['src/client.gen'] }, reportedFiles: new Set(), attributedFiles: [] });

		expect(changed).toStrictEqual([]);
	});

	test('outside a git worktree the agent report is the whole truth available', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const changed = await collectBatchChanges({ cwd, config, reportedFiles: new Set(['src/reported.ts']), attributedFiles: [] });

		// no git means no second opinion — degrade to what was reported
		expect(changed).toStrictEqual(['src/reported.ts']);
		expect(execSync('git rev-parse --is-inside-work-tree || true', { cwd, encoding: 'utf8' })).not.toContain('true');
	});
});
