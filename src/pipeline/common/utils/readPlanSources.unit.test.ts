import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { readPlanSources } from '@/pipeline/common/utils/readPlanSources';

/** A temp repo holding the given repo-relative files. */
const setupRepo = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-sources-'));

	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}

	return { cwd };
};

describe('readPlanSources', () => {
	test('reads the plan text a single-plan run works from', async () => {
		const { cwd } = setupRepo({ files: { '.lightsout/plans/add-search/plan.md': '# Plan\nbody\n' } });

		const sources = await readPlanSources({ cwd, plan: '.lightsout/plans/add-search/plan.md' });

		expect(sources).toStrictEqual({ planContent: '# Plan\nbody\n' });
	});

	test('reads the overview alongside the phase when the run has one', async () => {
		const { cwd } = setupRepo({
			files: { '.lightsout/plans/search/phase1.md': '# Phase 1\n', '.lightsout/plans/search/overview.md': '# Overview\n' },
		});

		const sources = await readPlanSources({ cwd, plan: '.lightsout/plans/search/phase1.md', overview: '.lightsout/plans/search/overview.md' });

		expect(sources).toStrictEqual({ planContent: '# Phase 1\n', overviewContent: '# Overview\n' });
	});

	test('an unreadable plan fails rather than spawning agents with nothing to implement', async () => {
		const { cwd } = setupRepo();

		const sources = await readPlanSources({ cwd, plan: '.lightsout/plans/ghost/plan.md' });

		expect('error' in sources && sources.error).toContain('plan file not found');
		expect('error' in sources && sources.error).toContain(join('ghost', 'plan.md'));
	});

	test('a declared overview that is missing fails, even though the plan itself read fine', async () => {
		const { cwd } = setupRepo({ files: { '.lightsout/plans/search/phase1.md': '# Phase 1\n' } });

		const sources = await readPlanSources({ cwd, plan: '.lightsout/plans/search/phase1.md', overview: '.lightsout/plans/search/overview.md' });

		expect('error' in sources && sources.error).toContain('overview file not found');
	});
});
