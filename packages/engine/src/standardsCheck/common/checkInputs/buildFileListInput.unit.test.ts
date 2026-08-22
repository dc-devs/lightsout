import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { buildFileListInput } from '#src/standardsCheck/common/checkInputs/buildFileListInput.ts';

/** A repo whose manifests are whatever the test needs them to be, written verbatim. */
const setupRepo = ({ manifests = {} }: { manifests?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-file-list-'));

	for (const [path, content] of Object.entries(manifests)) {
		mkdirSync(join(cwd, path, '..'), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}

	return { cwd };
};

const buildInput = ({ cwd }: { cwd: string }) =>
	buildFileListInput({
		cwd,
		source: ['src/alpha.ts'],
		tests: ['src/alpha.unit.test.ts'],
		files: ['src/alpha.ts', 'src/alpha.unit.test.ts'],
		referenceFiles: ['src/alpha.ts', 'src/alpha.unit.test.ts', 'src/outside.ts'],
		standardsPacks: [],
		packagesDir: 'packages',
	});

describe('buildFileListInput', () => {
	test('carries the path lists through untouched under its own kind', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd });

		expect(input.kind).toBe('file-list');
		expect(input.cwd).toBe(cwd);
		expect(input.source).toStrictEqual(['src/alpha.ts']);
		expect(input.tests).toStrictEqual(['src/alpha.unit.test.ts']);
		expect(input.files).toStrictEqual(['src/alpha.ts', 'src/alpha.unit.test.ts']);
		// the reference list is the whole repo, wider than the scoped files
		expect(input.referenceFiles).toHaveLength(3);
	});

	test('reads the root package dependencies as one union of the three declaration blocks', async () => {
		const { cwd } = setupRepo({
			manifests: {
				'package.json': JSON.stringify({
					dependencies: { react: '^19.0.0' },
					devDependencies: { jest: '^30.0.0' },
					peerDependencies: { zod: '^4.0.0' },
				}),
			},
		});

		const input = await buildInput({ cwd });

		expect(input.dependencies.get('.')?.sort()).toStrictEqual(['jest', 'react', 'zod']);
	});

	test('gives the root an empty list when the repo ships no package.json', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd });

		// the root is always an entry — "declares nothing" is an answer
		expect(input.dependencies.get('.')).toStrictEqual([]);
	});

	test('gives the root an empty list when its package.json cannot be understood', async () => {
		const { cwd } = setupRepo({ manifests: { 'package.json': 'not json at all' } });

		const input = await buildInput({ cwd });

		expect(input.dependencies.get('.')).toStrictEqual([]);
	});

	test('gives the root an empty list when its package.json is valid json of the wrong shape', async () => {
		const { cwd } = setupRepo({ manifests: { 'package.json': JSON.stringify({ dependencies: ['react'] }) } });

		expect((await buildInput({ cwd })).dependencies.get('.')).toStrictEqual([]);
	});

	test('adds one entry per workspace package and skips a child that is not one', async () => {
		const { cwd } = setupRepo({
			manifests: {
				'package.json': JSON.stringify({ dependencies: {} }),
				'packages/api/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
				'packages/web/package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }),
				'packages/notes/README.md': '# not a package\n',
			},
		});

		const input = await buildInput({ cwd });

		expect(input.dependencies.get('packages/api')).toStrictEqual(['@nestjs/core']);
		expect(input.dependencies.get('packages/web')).toStrictEqual(['react']);
		// a folder with no package.json is not a package, so it is not an entry
		expect(input.dependencies.has('packages/notes')).toBe(false);
	});
});
