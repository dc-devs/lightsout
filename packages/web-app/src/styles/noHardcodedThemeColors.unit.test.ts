/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from '@jest/globals';

const sourceRoot = join(__dirname, '..');

/** The literal colours a themed app must never spell, and the token that answers each. */
const forbidden = [
	{ pattern: /\bbg-white\b(?!\/)/, replacement: 'bg-background, bg-card or bg-surface' },
	{ pattern: /\btext-black\b(?!\/)/, replacement: 'text-foreground' },
];

const listSourceFiles = ({ directory }: { directory: string }) => {
	const files: string[] = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...listSourceFiles({ directory: path }));
		} else if (/\.tsx?$/.test(entry.name) && !/\.unit\.test\.tsx?$/.test(entry.name)) {
			files.push(path);
		}
	}

	return files;
};

const setupScan = () => {
	const files = listSourceFiles({ directory: sourceRoot });
	const violations: string[] = [];

	for (const file of files) {
		const lines = readFileSync(file, 'utf8').split('\n');

		lines.forEach((line, index) => {
			for (const { pattern, replacement } of forbidden) {
				if (pattern.test(line)) {
					violations.push(`${relative(sourceRoot, file).split(sep).join('/')}:${index + 1} — use ${replacement}`);
				}
			}
		});
	}

	return { files, violations };
};

/**
 * Both themes have to render correctly on every page, the sell zone included,
 * so a literal colour is a defect wherever it appears — there is no allowlist
 * and there is not meant to be one. A component states `bg-card` or
 * `text-foreground` and lets the theme decide what that is.
 *
 * An alpha variant such as `bg-black/50` is deliberately left alone: a
 * translucent scrim is a shadow rather than a surface, and it reads the same
 * over either theme.
 */
describe('no hardcoded theme colors', () => {
	test('scans the app source, so a walk that finds nothing cannot pass by default', () => {
		const { files } = setupScan();

		expect(files.length).toBeGreaterThan(20);
	});

	test('finds no literal light-mode colour in any component', () => {
		const { violations } = setupScan();

		expect(violations).toStrictEqual([]);
	});
});
