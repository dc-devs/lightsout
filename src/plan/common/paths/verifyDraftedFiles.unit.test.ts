import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { expectDefined } from '@tests/helpers/expectDefined';
import { verifyDraftedFiles } from '@/plan/common/paths/verifyDraftedFiles';

/** A temp repo holding the given repo-relative plan files. */
const setupRepo = ({ files = [] }: { files?: string[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-drafted-'));

	for (const file of files) {
		mkdirSync(dirname(join(cwd, file)), { recursive: true });
		writeFileSync(join(cwd, file), '# Plan\n');
	}

	return { cwd };
};

describe('verifyDraftedFiles', () => {
	test('resolves a repo-relative report path against the repo root', async () => {
		const { cwd } = setupRepo({ files: ['.claude/plans/add-search/plan.md'] });

		const result = await verifyDraftedFiles({ cwd, filesWritten: [{ path: '.claude/plans/add-search/plan.md' }] });

		expect(result).toStrictEqual({ planPaths: [join(cwd, '.claude/plans/add-search/plan.md')] });
	});

	test('keeps an absolute report path as given', async () => {
		const { cwd } = setupRepo({ files: ['.claude/plans/add-search/plan.md'] });
		const absolutePath = join(cwd, '.claude/plans/add-search/plan.md');

		const result = await verifyDraftedFiles({ cwd, filesWritten: [{ path: absolutePath }] });

		expect(result).toStrictEqual({ planPaths: [absolutePath] });
	});

	test('a report claiming a file that was never written fails rather than passing an empty plan on', async () => {
		const { cwd } = setupRepo();

		const result = await verifyDraftedFiles({ cwd, filesWritten: [{ path: '.claude/plans/ghost/plan.md' }] });

		expectDefined('error' in result ? result.error : undefined);
		expect('error' in result && result.error).toContain('reported files that were not written');
	});

	test('naming no files at all is its own failure, not an empty success', async () => {
		const { cwd } = setupRepo();

		const result = await verifyDraftedFiles({ cwd, filesWritten: [] });

		expect('error' in result && result.error).toBe('plan-writer reported drafted but listed no files written');
	});

	test('one missing file among several is reported by name', async () => {
		const { cwd } = setupRepo({ files: ['.claude/plans/add-search/overview.md'] });

		const result = await verifyDraftedFiles({
			cwd,
			filesWritten: [{ path: '.claude/plans/add-search/overview.md' }, { path: '.claude/plans/add-search/phase1-setup.md' }],
		});

		expect('error' in result && result.error).toContain('phase1-setup.md');
		expect('error' in result && result.error).not.toContain('overview.md');
	});
});
