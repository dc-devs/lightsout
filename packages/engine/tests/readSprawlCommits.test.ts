import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';
import { runSprawlDriver } from '#tests/helpers/sprawl/runSprawlDriver.ts';
import { seedSprawlRepo } from '#tests/helpers/sprawl/seedSprawlRepo.ts';

// Which commits become frames of the sprawl animation. The chart is about the
// shape of the TypeScript under packages/, so a commit that moved nothing there
// would hold the picture still for no reason a viewer could see.

const repos: string[] = [];

const setupHistory = ({ commits }: { commits: { message: string; at: string; write?: Record<string, string> }[] }) => {
	const cwd = seedSprawlRepo({ commits });

	repos.push(cwd);

	return { cwd };
};

const readCommits = ({ cwd }: { cwd: string }) =>
	runSprawlDriver<{ sha: string; at: string; subject: string }[]>({
		cwd,
		body: ["import { readSprawlCommits } from './scripts/readSprawlCommits.mjs';", '', 'report(readSprawlCommits({ repoRoot: import.meta.dirname }));'].join(
			'\n',
		),
	});

afterAll(() => {
	for (const cwd of repos) {
		rmSync(join(cwd, '..'), { recursive: true, force: true });
	}
});

describe('readSprawlCommits', () => {
	test('carries only the commits that changed TypeScript under packages, oldest first', () => {
		const { cwd } = setupHistory({
			commits: [
				{ message: 'a source file', at: '2026-01-01T00:00:00Z', write: { 'packages/app/src/a.ts': 'const a = 1;\n' } },
				{ message: 'docs only', at: '2026-01-02T00:00:00Z', write: { 'README.md': 'hello\n' } },
				{ message: 'a component', at: '2026-01-03T00:00:00Z', write: { 'packages/app/src/b.tsx': 'export const B = () => null;\n' } },
				{ message: 'typescript outside packages', at: '2026-01-04T00:00:00Z', write: { 'scripts/tool.ts': 'const t = 1;\n' } },
			],
		});

		const commits = readCommits({ cwd });

		expect(commits.map(({ at, subject }) => ({ day: at.slice(0, 10), subject }))).toStrictEqual([
			{ day: '2026-01-01', subject: 'a source file' },
			{ day: '2026-01-03', subject: 'a component' },
		]);
	});

	test('abbreviates the sha itself rather than letting git choose a width that grows with the repo', () => {
		const { cwd } = setupHistory({ commits: [{ message: 'a source file', at: '2026-01-01T00:00:00Z', write: { 'packages/app/src/a.ts': 'const a = 1;\n' } }] });

		const commits = readCommits({ cwd });

		expect(commits[0].sha).toMatch(/^[0-9a-f]{7}$/);
	});

	test('keeps a subject that contains a tab whole, rather than truncating it at the field separator', () => {
		const { cwd } = setupHistory({
			commits: [{ message: 'fix:\tthe tabbed subject', at: '2026-01-01T00:00:00Z', write: { 'packages/app/src/a.ts': 'const a = 1;\n' } }],
		});

		const commits = readCommits({ cwd });

		expect(commits[0].subject).toBe('fix:\tthe tabbed subject');
	});

	test('returns nothing when no commit has ever touched TypeScript under packages', () => {
		const { cwd } = setupHistory({ commits: [{ message: 'docs only', at: '2026-01-01T00:00:00Z', write: { 'README.md': 'hello\n' } }] });

		const commits = readCommits({ cwd });

		expect(commits).toStrictEqual([]);
	});
});
