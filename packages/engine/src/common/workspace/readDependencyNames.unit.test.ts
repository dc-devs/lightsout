import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readDependencyNames } from '#src/common/workspace/readDependencyNames.ts';

const manifestPathWith = ({ text }: { text: string }) => {
	const manifestPath = join(mkdtempSync(join(tmpdir(), 'lightsout-deps-')), 'package.json');

	writeFileSync(manifestPath, text);

	return manifestPath;
};

describe('readDependencyNames', () => {
	test('unions all three dependency sections — the question is what a package declares', async () => {
		const manifestPath = manifestPathWith({
			text: JSON.stringify({ dependencies: { react: '^19' }, devDependencies: { jest: '^30' }, peerDependencies: { zod: '^4' } }),
		});

		expect(await readDependencyNames({ manifestPath })).toStrictEqual(['react', 'jest', 'zod']);
	});

	test('a directory with no manifest is not a package — undefined, so callers can drop it entirely', async () => {
		expect(await readDependencyNames({ manifestPath: join(tmpdir(), 'lightsout-nowhere', 'package.json') })).toBeUndefined();
	});

	test('a manifest that exists but cannot be understood declares nothing rather than failing the run', async () => {
		expect(await readDependencyNames({ manifestPath: manifestPathWith({ text: 'not json' }) })).toStrictEqual([]);
		expect(await readDependencyNames({ manifestPath: manifestPathWith({ text: JSON.stringify({ dependencies: 'nope' }) }) })).toStrictEqual([]);
	});
});
