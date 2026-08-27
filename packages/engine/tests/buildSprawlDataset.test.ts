import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';
import { runSprawlDriver } from '#tests/helpers/sprawl/runSprawlDriver.ts';
import { seedSprawlRepo } from '#tests/helpers/sprawl/seedSprawlRepo.ts';

// The whole author-time build of assets/sprawl-dataset.json, run against real
// git history. What it writes is a committed artifact the site imports, so the
// shape of a frame, the delta encoding and the byte-for-byte determinism are
// all contracts rather than implementation details.

interface Delta {
	files: { path: string; lines: number }[];
	folders: { path: string; entries: number }[];
	removedFiles: string[];
	removedFolders: string[];
	overCap: number;
}

interface Dataset {
	headSha: string;
	caps: Record<string, number>;
	droppedCommits: number;
	frames: { sha: string; at: string; subject: string; isRefactorMarker: boolean; with: Delta; without: Delta }[];
}

const lines = ({ count }: { count: number }) => 'const x = 1;\n'.repeat(count);
const repos: string[] = [];

/** Three commits in which one file grows past the cap and then graduates into a folder of its own. */
const setupGraduationHistory = () => {
	const cwd = seedSprawlRepo({
		commits: [
			{
				message: 'the file before it split',
				at: '2026-02-01T00:00:00Z',
				write: { 'packages/app/src/big.ts': lines({ count: 100 }), 'packages/app/src/other.ts': lines({ count: 10 }) },
			},
			{
				message: 'the split',
				at: '2026-02-02T00:00:00Z',
				write: { 'packages/app/src/big/index.ts': lines({ count: 20 }), 'packages/app/src/big/part.ts': lines({ count: 90 }) },
				remove: ['packages/app/src/big.ts'],
			},
			{ message: 'a later edit', at: '2026-02-03T00:00:00Z', write: { 'packages/app/src/other.ts': lines({ count: 12 }) } },
		],
	});

	repos.push(cwd);

	return { cwd };
};

const setupHistoryWithoutTypeScript = () => {
	const cwd = seedSprawlRepo({ commits: [{ message: 'docs only', at: '2026-02-01T00:00:00Z', write: { 'README.md': 'hello\n' } }] });

	repos.push(cwd);

	return { cwd };
};

const setupLongHistory = ({ count }: { count: number }) => {
	const cwd = seedSprawlRepo({
		commits: Array.from({ length: count }, (_, index) => ({
			message: `commit ${index}`,
			at: '2026-02-01T00:00:00Z',
			write: { 'packages/app/src/grow.ts': lines({ count: index + 1 }) },
		})),
	});

	repos.push(cwd);

	return { cwd };
};

const buildDataset = ({ cwd }: { cwd: string }) =>
	runSprawlDriver<{ logs: string[]; dataset?: Dataset }>({
		cwd,
		body: [
			"import { buildSprawlDataset } from './scripts/buildSprawlDataset.mjs';",
			'',
			'const logs = [];',
			'const dataset = buildSprawlDataset({ log: (line) => logs.push(line) });',
			'',
			'report({ logs, dataset });',
		].join('\n'),
	});

/** Both files a rebuild at the same HEAD writes, so a difference between them is a determinism failure. */
const buildDatasetTwice = ({ cwd }: { cwd: string }) =>
	runSprawlDriver<{ first: string; second: string }>({
		cwd,
		body: [
			"import { readFileSync } from 'node:fs';",
			"import { buildSprawlDataset } from './scripts/buildSprawlDataset.mjs';",
			'',
			"const output = new URL('./assets/sprawl-dataset.json', import.meta.url);",
			'',
			'buildSprawlDataset({ log: () => undefined });',
			"const first = readFileSync(output, 'utf8');",
			'',
			'buildSprawlDataset({ log: () => undefined });',
			"const second = readFileSync(output, 'utf8');",
			'',
			'report({ first, second });',
		].join('\n'),
	});

const runAsCommand = ({ cwd }: { cwd: string }) => spawnSync('node', [join(cwd, 'scripts', 'buildSprawlDataset.mjs')], { cwd, encoding: 'utf8' });

afterAll(() => {
	for (const cwd of repos) {
		rmSync(join(cwd, '..'), { recursive: true, force: true });
	}
});

describe('buildSprawlDataset', () => {
	test('stamps the dataset with the commit it was built at and the caps read from the pack', () => {
		const { cwd } = setupGraduationHistory();

		const { dataset } = buildDataset({ cwd });

		expect({ headSha: dataset?.headSha, caps: dataset?.caps, droppedCommits: dataset?.droppedCommits }).toStrictEqual({
			headSha: dataset?.frames[2].sha,
			caps: { file: 100, tsxFile: 120, function: 30, testFile: 400, folderCensus: 3 },
			droppedCommits: 0,
		});
	});

	test('carries the whole tree in the first frame, with both removal lists empty', () => {
		const { cwd } = setupGraduationHistory();

		const { dataset } = buildDataset({ cwd });

		expect(dataset?.frames[0].with).toStrictEqual({
			files: [
				{ path: 'packages/app/src/big.ts', lines: 100 },
				{ path: 'packages/app/src/other.ts', lines: 10 },
			],
			folders: [{ path: 'packages/app/src', entries: 2 }],
			removedFiles: [],
			removedFolders: [],
			overCap: 0,
		});
	});

	test('carries only what changed in a later frame, and sends the deleted path out of band', () => {
		const { cwd } = setupGraduationHistory();

		const { dataset } = buildDataset({ cwd });

		expect(dataset?.frames[1].with).toStrictEqual({
			files: [
				{ path: 'packages/app/src/big/index.ts', lines: 20 },
				{ path: 'packages/app/src/big/part.ts', lines: 90 },
			],
			folders: [
				{ path: 'packages/app/src', entries: 1 },
				{ path: 'packages/app/src/big', entries: 2 },
			],
			removedFiles: ['packages/app/src/big.ts'],
			removedFolders: [],
			overCap: 0,
		});
	});

	test('keeps the graduated file growing at its old path in the without lane, over the cap the with lane stays under', () => {
		const { cwd } = setupGraduationHistory();

		const { dataset } = buildDataset({ cwd });

		expect(dataset?.frames[1].without).toStrictEqual({
			files: [{ path: 'packages/app/src/big.ts', lines: 110 }],
			folders: [],
			removedFiles: [],
			removedFolders: [],
			overCap: 1,
		});
	});

	test('names each frame with the commit it was measured at', () => {
		const { cwd } = setupGraduationHistory();

		const { dataset } = buildDataset({ cwd });

		expect(dataset?.frames.map((frame) => ({ day: frame.at.slice(0, 10), subject: frame.subject }))).toStrictEqual([
			{ day: '2026-02-01', subject: 'the file before it split' },
			{ day: '2026-02-02', subject: 'the split' },
			{ day: '2026-02-03', subject: 'a later edit' },
		]);
	});

	test('says how much history it read and what it wrote', () => {
		const { cwd } = setupGraduationHistory();

		const { logs } = buildDataset({ cwd });

		expect(logs).toEqual(expect.arrayContaining([expect.stringMatching(/reading 3 commit/), expect.stringMatching(/wrote assets\/sprawl-dataset\.json/)]));
	});

	test('writes a byte-identical file when it is run twice at the same HEAD', () => {
		const { cwd } = setupGraduationHistory();

		const { first, second } = buildDatasetTwice({ cwd });

		expect(second).toBe(first);
	});

	test('writes the dataset when the script is run as a command rather than imported', () => {
		const { cwd } = setupGraduationHistory();

		const result = runAsCommand({ cwd });

		const written = JSON.parse(readFileSync(join(cwd, 'assets', 'sprawl-dataset.json'), 'utf8')) as Dataset;
		expect({ status: result.status, frames: written.frames.length, said: /wrote assets\/sprawl-dataset\.json/.test(result.stdout) }).toStrictEqual({
			status: 0,
			frames: 3,
			said: true,
		});
	});

	test('fails, rather than writing an empty animation, when no commit has ever touched TypeScript under packages', () => {
		const { cwd } = setupHistoryWithoutTypeScript();

		const result = runAsCommand({ cwd });

		expect({ status: result.status, said: /there is no history to animate/.test(result.stderr) }).toStrictEqual({ status: 1, said: true });
	});

	test('drops the oldest commits past the 400-frame cap and says how many it dropped', () => {
		const { cwd } = setupLongHistory({ count: 403 });

		const { logs, dataset } = buildDataset({ cwd });

		expect({
			dropped: dataset?.droppedCommits,
			frames: dataset?.frames.length,
			logged: logs.some((line) => /3 commit\(s\) dropped/.test(line)),
		}).toStrictEqual({ dropped: 3, frames: 400, logged: true });
	}, 120_000);
});
