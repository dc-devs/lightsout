import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { checkRenameOnlyChanges } from '#src/pipeline/renameCheck/checkRenameOnlyChanges.ts';
import { commitAll } from '#tests/helpers/commitAll.ts';
import { generatedPaths } from '#tests/helpers/generatedPaths.ts';
import { runInRepo } from '#tests/helpers/runInRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

/** The capitalised form first, so each rename's new text contains no rename's old text. */
const widgetToGadget: RenameRule[] = [
	{ from: 'Widget', to: 'Gadget', line: 20 },
	{ from: 'widget', to: 'gadget', line: 21 },
];

/**
 * A PipelineRun stub over a real git repo. `committed` is what `HEAD` carries at
 * the phase start, on top of the repo's own `src/index.js`; `remove` and `write`
 * are what the implement agent left in the working tree when the checkpoint
 * arrives, unstaged — so a move is a deleted old path beside an untracked new one.
 * `createdAndDeleted` are files the agent staged and then deleted within the run,
 * which git reports as `AD`. Every progress line the check narrates is kept.
 */
const setupRenameCheck = ({
	git = true,
	committed = {},
	remove = [],
	write = {},
	baselineDirtyFiles = [],
	generated,
	createdAndDeleted = [],
}: {
	git?: boolean;
	committed?: Record<string, string>;
	remove?: string[];
	write?: Record<string, string>;
	baselineDirtyFiles?: string[];
	generated?: string[];
	createdAndDeleted?: string[];
} = {}) => {
	const cwd = setupConsumerRepo({ git });

	for (const [path, content] of Object.entries(committed)) {
		writeRepoFile({ cwd, path, content });
	}

	if (git && Object.keys(committed).length > 0) {
		commitAll({ cwd, message: 'the phase start' });
	}

	for (const path of remove) {
		rmSync(join(cwd, path));
	}

	for (const [path, content] of Object.entries(write)) {
		writeRepoFile({ cwd, path, content });
	}

	for (const path of createdAndDeleted) {
		writeRepoFile({ cwd, path, content: 'export const transient = 1;\n' });
		runInRepo({ cwd, command: 'git', args: ['add', path] });
		rmSync(join(cwd, path));
	}

	const progressLines: string[] = [];
	const manifest = { runId: 'run-1', changedFiles: [], packages: [], baselineDirtyFiles } as unknown as RunManifest;
	const run = {
		cwd,
		config: { gates: { check: 'true', test: 'true' }, ...(generated ? { generated } : {}) } as unknown as LightsoutConfig,
		current: () => manifest,
		progress: (message: string) => {
			progressLines.push(message);
		},
	} as unknown as PipelineRun;

	return { run, progressLines };
};

describe('checkRenameOnlyChanges', () => {
	test('checkRenameOnlyChanges: moved and edited files that hold only the declared renames pass, whatever the whitespace, import order and trailing commas', async () => {
		const { run } = setupRenameCheck({
			committed: {
				'src/widget.ts': [
					"import { alpha } from './alpha.ts';",
					"import { beta } from './beta.ts';",
					'',
					'export const widgetLabel = (name: string) => formatWidget({ name, prefix: alpha, suffix: beta });',
					'',
				].join('\n'),
				'src/widget.unit.test.ts': [
					"import { widgetLabel } from './widget.ts';",
					'',
					"test('widgetLabel: names the widget', () => {",
					"\texpect(widgetLabel('a')).toBe('Widget a');",
					'});',
					'',
				].join('\n'),
				'src/main.ts': "import { widgetLabel } from './widget.ts';\n\nconsole.log(widgetLabel('a'));\n",
			},
			remove: ['src/widget.ts', 'src/widget.unit.test.ts'],
			write: {
				'src/gadget.ts': [
					"import { beta } from './beta.ts';",
					"import { alpha } from './alpha.ts';",
					'',
					'export const gadgetLabel = (name: string) =>',
					'\tformatGadget({',
					'\t\tname,',
					'\t\tprefix: alpha,',
					'\t\tsuffix: beta,',
					'\t});',
					'',
				].join('\n'),
				'src/gadget.unit.test.ts': [
					"import { gadgetLabel } from './gadget.ts';",
					'',
					"test('gadgetLabel: names the gadget', () => {",
					'\texpect(',
					"\t\tgadgetLabel('a'),",
					"\t).toBe('Gadget a');",
					'});',
					'',
				].join('\n'),
				'src/main.ts': "import { gadgetLabel } from './gadget.ts';\n\nconsole.log(\n\tgadgetLabel('a'),\n);\n",
			},
		});

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-implement', renames: widgetToGadget });

		// the formatter re-wraps, re-sorts imports and adds trailing commas when a
		// path changes — none of that is a change the renames fail to explain
		expect(result).toStrictEqual({});
	});

	test('checkRenameOnlyChanges: a file whose tokens differ after the renames is refused with the tokens it added and removed', async () => {
		const { run } = setupRenameCheck({
			committed: { 'src/widget.ts': 'export const widgetSize = 2;\n' },
			remove: ['src/widget.ts'],
			write: {
				'src/gadget.ts': 'export const gadgetSize = 3;\n',
				'src/index.js': 'export const one = 1 + bonus;\n',
			},
		});

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-implement', renames: widgetToGadget });

		const lines = (result.error ?? '').split('\n');
		const movedLine = lines.find((line) => /src\/(widget|gadget)\.ts/.test(line));
		const editedLine = lines.find((line) => line.includes('src/index.js'));

		// each refused file is its own line, naming what the change added and what
		// it removed — the moved file traded `2` for `3`, the edited one gained `+ bonus`
		expect({ movedLine, editedLine }).toEqual({
			movedLine: expect.stringMatching(/^(?=.*(?<![\w.])3(?![\w.]))(?=.*(?<![\w.])2(?![\w.]))/),
			editedLine: expect.stringMatching(/^(?=.*\bbonus\b)(?=.*\+)/),
		});
	});

	test('checkRenameOnlyChanges: an added file with no renamed source and a removed file with no renamed destination are refused', async () => {
		const { run } = setupRenameCheck({
			committed: { 'src/widgetHelpers.ts': 'export const helper = 1;\n' },
			remove: ['src/widgetHelpers.ts'],
			write: { 'src/extra.ts': 'export const extra = 1;\n' },
		});

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-tests', renames: widgetToGadget });

		// a rename moves a file; it never creates one or deletes one, and
		// `src/gadgetHelpers.ts` — where the removed file's rename leads — was never added
		expect({
			namesAdded: result.error?.includes('src/extra.ts'),
			namesRemoved: result.error?.includes('src/widgetHelpers.ts'),
		}).toStrictEqual({ namesAdded: true, namesRemoved: true });
	});

	test('checkRenameOnlyChanges: renames apply in the declared order', async () => {
		const { run } = setupRenameCheck({
			committed: { 'src/accepted.txt': 'fooBar foo\n', 'src/refused.txt': 'fooBar foo\n' },
			write: { 'src/accepted.txt': 'qux baz\n', 'src/refused.txt': 'bazBar baz\n' },
		});

		const result = await checkRenameOnlyChanges({
			run,
			checkpoint: 'verify-implement',
			renames: [
				{ from: 'fooBar', to: 'qux', line: 20 },
				{ from: 'foo', to: 'baz', line: 21 },
			],
		});

		// `fooBar` is renamed before `foo` is, so it becomes `qux` and never `bazBar`
		expect({
			refusesAccepted: result.error?.includes('src/accepted.txt'),
			refusesRefused: result.error?.includes('src/refused.txt'),
		}).toStrictEqual({ refusesAccepted: false, refusesRefused: true });
	});

	test('checkRenameOnlyChanges: files dirty before the run, generated paths and run state are left out', async () => {
		const { run } = setupRenameCheck({
			committed: { 'notes/dirty.md': 'written before the run\n', 'packages/web-app/src/routeTree.gen.ts': 'export const routes = [];\n' },
			write: {
				'notes/dirty.md': 'rewritten by the user before the run began\n',
				'packages/web-app/src/routeTree.gen.ts': 'export const routes = [home, about];\n',
				'plugin/dist/bundle.js': 'console.log(1);\n',
				'.lightsout/runs/run-1/manifest.json': '{ "runId": "run-1" }\n',
			},
			baselineDirtyFiles: ['notes/dirty.md'],
			generated: generatedPaths,
		});

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-implement', renames: widgetToGadget });

		expect(result).toStrictEqual({});
	});

	test('checkRenameOnlyChanges: refuses when git cannot report the working changes', async () => {
		const { run } = setupRenameCheck({ git: false, write: { 'src/extra.ts': 'export const extra = 1;\n' } });

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-implement', renames: widgetToGadget });

		// no git truth means nothing is proven, so the check fails closed
		expect(result).toEqual({ error: expect.stringMatching(/working changes/) });
	});

	test('checkRenameOnlyChanges: a removed file whose path no declared rename touches is refused', async () => {
		const { run } = setupRenameCheck({
			committed: { 'src/helpers.ts': 'export const helper = 1;\n' },
			remove: ['src/helpers.ts'],
		});

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-implement', renames: widgetToGadget });

		// no rename leads anywhere from this path, so the change is a deletion
		expect(result).toEqual({ error: expect.stringMatching(/^- src\/helpers\.ts: /m) });
	});

	test('checkRenameOnlyChanges: a file created and deleted within the run is no change at all', async () => {
		const { run } = setupRenameCheck({ createdAndDeleted: ['src/scratch.ts'] });

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-implement', renames: widgetToGadget });

		// absent from `HEAD` and from disk, it is neither a removal to pair nor a file to compare
		expect(result).toStrictEqual({});
	});

	test('checkRenameOnlyChanges: a rewritten file lists at most twenty added tokens and counts the rest', async () => {
		const words = Array.from({ length: 25 }, (_, index) => `word${index}`);
		const { run } = setupRenameCheck({
			committed: { 'notes/widget.md': 'widget\n' },
			write: { 'notes/widget.md': `widget ${words.join(' ')}\n` },
		});

		const result = await checkRenameOnlyChanges({ run, checkpoint: 'verify-implement', renames: widgetToGadget });

		const refusal = (result.error ?? '').split('\n').find((line) => line.includes('notes/widget.md')) ?? '';

		// one rewritten file cannot bury the others: twenty named, the other five counted
		expect({
			named: words.filter((word) => refusal.includes(`\`${word}\``)).length,
			countsTheRest: /\b5 more\b/.test(refusal),
		}).toStrictEqual({ named: 20, countsTheRest: true });
	});

	test('checkRenameOnlyChanges: narrates the checkpoint and the file count when it starts, and a pass when every file holds', async () => {
		const { run, progressLines } = setupRenameCheck({
			committed: { 'src/widget.txt': 'widget\n' },
			write: { 'src/widget.txt': 'gadget\n' },
		});

		await checkRenameOnlyChanges({ run, checkpoint: 'verify-tests', renames: widgetToGadget });

		expect(progressLines).toEqual([expect.stringMatching(/^verify-tests: .*\b1\b/), expect.stringMatching(/^verify-tests: /)]);
	});
});
