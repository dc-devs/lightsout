import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readPackageDependencies } from '#src/common/workspace/readPackageDependencies.ts';

/** A temp repo holding exactly the files named — every other path simply does not exist. */
const setupRepo = ({ files }: { files: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-package-deps-'));

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(cwd, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { cwd };
};

describe('readPackageDependencies', () => {
	test('keys the repo itself on `.` and every workspace package on its repo-relative root', async () => {
		const { cwd } = setupRepo({
			files: {
				'package.json': '{ "name": "root", "devDependencies": { "typescript": "^5" } }\n',
				'packages/web/package.json': '{ "name": "web", "dependencies": { "@tanstack/react-router": "^1" } }\n',
				'packages/api/package.json': '{ "name": "api", "dependencies": { "@nestjs/core": "^11" } }\n',
			},
		});

		const dependencies = await readPackageDependencies({ cwd, packagesDir: 'packages' });

		expect(dependencies).toStrictEqual(
			new Map([
				['.', ['typescript']],
				['packages/api', ['@nestjs/core']],
				['packages/web', ['@tanstack/react-router']],
			]),
		);
	});

	test('reads the package parent dir it was given, not the default name', async () => {
		const { cwd } = setupRepo({
			files: {
				'package.json': '{ "name": "root" }\n',
				'modules/web/package.json': '{ "name": "web", "dependencies": { "expo-router": "^4" } }\n',
				'packages/web/package.json': '{ "name": "decoy", "dependencies": { "next": "^15" } }\n',
			},
		});

		const dependencies = await readPackageDependencies({ cwd, packagesDir: 'modules' });

		// a repo that keeps its packages under another name would otherwise have
		// every workspace manifest fall out of the map, silently
		expect(dependencies).toStrictEqual(
			new Map([
				['.', []],
				['modules/web', ['expo-router']],
			]),
		);
	});

	test('walks the children in name order, so two runs of one repo read the same', async () => {
		const { cwd } = setupRepo({
			files: {
				'package.json': '{ "name": "root" }\n',
				'packages/zulu/package.json': '{ "name": "zulu" }\n',
				'packages/alpha/package.json': '{ "name": "alpha" }\n',
				'packages/mike/package.json': '{ "name": "mike" }\n',
			},
		});

		const dependencies = await readPackageDependencies({ cwd, packagesDir: 'packages' });

		expect([...dependencies.keys()]).toStrictEqual(['.', 'packages/alpha', 'packages/mike', 'packages/zulu']);
	});

	test('a child of the packages dir that ships no manifest is not a package, and drops out entirely', async () => {
		const { cwd } = setupRepo({
			files: {
				'package.json': '{ "name": "root" }\n',
				'packages/web/package.json': '{ "name": "web", "peerDependencies": { "react": "^19" } }\n',
				'packages/notes/README.md': '# not a package\n',
			},
		});

		const dependencies = await readPackageDependencies({ cwd, packagesDir: 'packages' });

		// an empty entry would read as "a package declaring nothing", which is a
		// different answer from "no package here"
		expect(dependencies).toStrictEqual(
			new Map([
				['.', []],
				['packages/web', ['react']],
			]),
		);
	});

	test('a repo with no root manifest still gets its `.` entry, declaring nothing', async () => {
		const { cwd } = setupRepo({ files: { 'packages/web/package.json': '{ "name": "web", "dependencies": { "next": "^15" } }\n' } });

		const dependencies = await readPackageDependencies({ cwd, packagesDir: 'packages' });

		// a rule reading the map never has to tell "no manifest" from "no
		// dependencies" at the root
		expect(dependencies).toStrictEqual(
			new Map([
				['.', []],
				['packages/web', ['next']],
			]),
		);
	});

	test('a repo with no packages dir at all is the single-package case, not a failure', async () => {
		const { cwd } = setupRepo({ files: { 'package.json': '{ "name": "solo", "dependencies": { "react": "^19" } }\n' } });

		const dependencies = await readPackageDependencies({ cwd, packagesDir: 'packages' });

		expect(dependencies).toStrictEqual(new Map([['.', ['react']]]));
	});
});
