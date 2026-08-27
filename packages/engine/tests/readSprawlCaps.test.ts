import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';
import { runSprawlDriver } from '#tests/helpers/sprawl/runSprawlDriver.ts';
import { seedSprawlRepo } from '#tests/helpers/sprawl/seedSprawlRepo.ts';

// Where the sprawl animation's five numbers come from. The page tells a reader
// what this repo's caps are, so every one of them is read from the standards
// pack's own rule file — and a rule file that cannot answer has to stop the
// build rather than let a plausible number ship.

const sizeFileRule = 'code/style-guide/patterns/functions/30-size-file/rule.md';
const sizeFunctionRule = 'code/style-guide/patterns/functions/25-size-function/rule.md';
const repos: string[] = [];

const setupCapsRepo = ({ rules }: { rules?: Record<string, string | undefined> } = {}) => {
	const cwd = seedSprawlRepo({ rules });

	repos.push(cwd);

	return { cwd };
};

/** The script's answer, or the message it refused with. */
const readCaps = ({ cwd }: { cwd: string }) =>
	runSprawlDriver<{ caps?: Record<string, number>; error?: string }>({
		cwd,
		body: [
			"import { readSprawlCaps } from './scripts/readSprawlCaps.mjs';",
			'',
			'try {',
			'\treport({ caps: readSprawlCaps({ repoRoot: import.meta.dirname }) });',
			'} catch (error) {',
			'\treport({ error: error.message });',
			'}',
		].join('\n'),
	});

afterAll(() => {
	for (const cwd of repos) {
		rmSync(join(cwd, '..'), { recursive: true, force: true });
	}
});

describe('readSprawlCaps', () => {
	test('reads all five caps from the pack rule files that own them', () => {
		const { cwd } = setupCapsRepo();

		const result = readCaps({ cwd });

		expect(result.caps).toStrictEqual({ file: 100, tsxFile: 120, function: 30, testFile: 400, folderCensus: 3 });
	});

	test('spells the caps in the order the dataset declares them, so a rebuild cannot reshuffle the JSON', () => {
		const { cwd } = setupCapsRepo();

		const result = readCaps({ cwd });

		expect(Object.keys(result.caps ?? {})).toStrictEqual(['file', 'tsxFile', 'function', 'testFile', 'folderCensus']);
	});

	test('stops reading at the first line that is not a setting, so prose below the front matter cannot be mistaken for a cap', () => {
		const { cwd } = setupCapsRepo({
			rules: { [sizeFileRule]: ['---', 'settings:', '  file: 100', '  tsxFile: 120', '---', '', '  tsxFile: 999', ''].join('\n') },
		});

		const result = readCaps({ cwd });

		expect(result.caps).toEqual(expect.objectContaining({ tsxFile: 120 }));
	});

	test('refuses when a rule file carries no settings block', () => {
		const { cwd } = setupCapsRepo({ rules: { [sizeFunctionRule]: ['---', 'summary: "no numbers here"', '---', ''].join('\n') } });

		const result = readCaps({ cwd });

		expect(result.error).toMatch(/25-size-function\/rule\.md has no settings: block/);
	});

	test('refuses when a settings block is missing the key the cap is read from', () => {
		const { cwd } = setupCapsRepo({ rules: { [sizeFileRule]: ['---', 'settings:', '  file: 100', '---', ''].join('\n') } });

		const result = readCaps({ cwd });

		expect(result.error).toMatch(/has no numeric `tsxFile` setting/);
	});

	test('refuses when a settings key is present but not a number', () => {
		const { cwd } = setupCapsRepo({ rules: { [sizeFunctionRule]: ['---', 'settings:', '  function: soon', '---', ''].join('\n') } });

		const result = readCaps({ cwd });

		expect(result.error).toMatch(/has no numeric `function` setting/);
	});

	test('refuses when a rule file the caps come from is not there at all', () => {
		const { cwd } = setupCapsRepo({ rules: { [sizeFunctionRule]: undefined } });

		const result = readCaps({ cwd });

		expect(result.error).toMatch(/25-size-function/);
	});
});
