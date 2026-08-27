import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Which rule file answers which cap. Every number the animation states is read from one of these. */
const capSources = [
	{ rule: 'code/style-guide/patterns/functions/30-size-file/rule.md', keys: { file: 'file', tsxFile: 'tsxFile' } },
	{ rule: 'code/style-guide/patterns/functions/25-size-function/rule.md', keys: { function: 'function' } },
	{ rule: 'tests/unit-testing/18-test-size-file/rule.md', keys: { testFile: 'testFile' } },
	{ rule: 'code/architecture/folder-structure/35-crowded-folder/rule.md', keys: { folderCensus: 'cap' } },
];

/**
 * The numbers under a rule's `settings:` front-matter key.
 *
 * A small line reader rather than a YAML dependency: the block is two levels
 * deep and always numeric, and the front matter is the pack's own contract
 * rather than arbitrary user input.
 */
const readSettings = ({ path }) => {
	const lines = readFileSync(path, 'utf8').split('\n');
	const start = lines.findIndex((line) => line.trim() === 'settings:');

	if (start === -1) {
		throw new Error(`${path} has no settings: block — the caps the animation states have to be read from the pack, never typed in`);
	}

	const settings = {};

	for (const line of lines.slice(start + 1)) {
		const entry = /^\s+([A-Za-z][\w-]*):\s*(.+?)\s*$/.exec(line);

		if (entry === null) {
			break;
		}

		settings[entry[1]] = Number(entry[2]);
	}

	return settings;
};

/**
 * The five caps the sprawl animation draws and names, read from the standards
 * pack's own rule files.
 *
 * A missing rule file or a missing key is a hard error. A page that tells a
 * reader what the cap is must not be stating a guess, and the honest failure is
 * the one that stops the build rather than the one that ships a plausible
 * number.
 *
 * @param repoRoot - the repository holding `packages/standards-typescript`
 * @throws {Error} When a rule file, its settings block, or a named key is missing
 */
export const readSprawlCaps = ({ repoRoot }) => {
	const packRoot = join(repoRoot, 'packages', 'standards-typescript');
	const caps = {};

	for (const { rule, keys } of capSources) {
		const settings = readSettings({ path: join(packRoot, rule) });

		for (const [cap, key] of Object.entries(keys)) {
			if (!Number.isFinite(settings[key])) {
				throw new Error(`${rule} has no numeric \`${key}\` setting`);
			}

			caps[cap] = settings[key];
		}
	}

	// Spelled out rather than returned as accumulated, so the JSON's key order is
	// the contract's key order and a rebuild cannot reshuffle it.
	return { file: caps.file, tsxFile: caps.tsxFile, function: caps.function, testFile: caps.testFile, folderCensus: caps.folderCensus };
};
