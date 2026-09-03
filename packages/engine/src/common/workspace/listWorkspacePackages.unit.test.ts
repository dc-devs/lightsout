import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { listWorkspacePackages } from '#src/common/workspace/listWorkspacePackages.ts';

const setupWorkspace = () => mkdtempSync(join(tmpdir(), 'lightsout-workspace-packages-'));

const writePackage = ({ cwd, dir, raw = JSON.stringify({ name: dir }) }: { cwd: string; dir: string; raw?: string }) => {
	mkdirSync(join(cwd, 'packages', dir), { recursive: true });
	writeFileSync(join(cwd, 'packages', dir, 'package.json'), raw);
};

test('listWorkspacePackages: lists the directories that hold a package.json', async () => {
	const cwd = setupWorkspace();

	writePackage({ cwd, dir: 'api' });
	writePackage({ cwd, dir: 'web' });

	expect((await listWorkspacePackages({ cwd, packagesDir: 'packages' })).sort()).toStrictEqual(['api', 'web']);
});

test('listWorkspacePackages: skips a directory with no package.json', async () => {
	const cwd = setupWorkspace();

	writePackage({ cwd, dir: 'api' });
	mkdirSync(join(cwd, 'packages', 'notes'), { recursive: true });

	expect(await listWorkspacePackages({ cwd, packagesDir: 'packages' })).toStrictEqual(['api']);
});

test('listWorkspacePackages: skips a dotted directory', async () => {
	const cwd = setupWorkspace();

	writePackage({ cwd, dir: 'api' });
	writePackage({ cwd, dir: '.turbo' });

	expect(await listWorkspacePackages({ cwd, packagesDir: 'packages' })).toStrictEqual(['api']);
});

test('listWorkspacePackages: skips a plain file sitting beside the package directories', async () => {
	const cwd = setupWorkspace();

	writePackage({ cwd, dir: 'api' });
	writeFileSync(join(cwd, 'packages', 'README.md'), '# packages\n');

	expect(await listWorkspacePackages({ cwd, packagesDir: 'packages' })).toStrictEqual(['api']);
});

test('listWorkspacePackages: returns an empty list when the packages dir does not exist', async () => {
	const cwd = setupWorkspace();

	expect(await listWorkspacePackages({ cwd, packagesDir: 'packages' })).toStrictEqual([]);
});

test('listWorkspacePackages: a package whose package.json is unparseable still exists', async () => {
	const cwd = setupWorkspace();

	writePackage({ cwd, dir: 'api', raw: '{ not json' });

	// saying otherwise would steal readPackageManifest's precise error about the
	// broken manifest, and would be untrue: the package is right there
	expect(await listWorkspacePackages({ cwd, packagesDir: 'packages' })).toStrictEqual(['api']);
});
