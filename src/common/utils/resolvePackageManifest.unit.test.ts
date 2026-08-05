import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolvePackageManifest } from '@/common/utils/resolvePackageManifest';

const setupPackage = ({ raw }: { raw?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-manifest-'));

	mkdirSync(join(cwd, 'packages/api'), { recursive: true });

	if (raw !== undefined) {
		writeFileSync(join(cwd, 'packages/api/package.json'), raw);
	}

	return { cwd, manifestPath: join(cwd, 'packages/api/package.json') };
};

test('resolvePackageManifest: the workspace filter name and scripts map come from the package.json, not the directory', async () => {
	const { cwd } = setupPackage({ raw: JSON.stringify({ name: '@acme/backend-api', version: '1.2.3', scripts: { check: 'tsc -p .', 'test:unit': 'jest' } }) });

	const manifest = await resolvePackageManifest({ cwd, packagesDir: 'packages', packageDir: 'api' });

	assert.deepEqual(manifest, { name: '@acme/backend-api', scripts: { check: 'tsc -p .', 'test:unit': 'jest' } });
});

test('resolvePackageManifest: a package.json with no scripts block resolves to an empty scripts map', async () => {
	const { cwd } = setupPackage({ raw: JSON.stringify({ name: '@acme/infra' }) });

	const manifest = await resolvePackageManifest({ cwd, packagesDir: 'packages', packageDir: 'api' });

	assert.deepEqual(manifest, { name: '@acme/infra', scripts: {} }, 'a scriptless package is a valid package, and scoped gates read an empty map to decide what to skip');
});

test('resolvePackageManifest: a declared package with no package.json is a hard error naming the path', async () => {
	const { cwd, manifestPath } = setupPackage();

	await assert.rejects(
		resolvePackageManifest({ cwd, packagesDir: 'packages', packageDir: 'api' }),
		(error: unknown) => error instanceof Error && error.message === `declared package 'api' has no package.json at ${manifestPath}`,
	);
});

test('resolvePackageManifest: a nameless package.json is a hard error — the engine never guesses a filter', async () => {
	const { cwd, manifestPath } = setupPackage({ raw: JSON.stringify({ version: '1.0.0', scripts: { check: 'tsc' } }) });

	await assert.rejects(
		resolvePackageManifest({ cwd, packagesDir: 'packages', packageDir: 'api' }),
		(error: unknown) => error instanceof Error && error.message === `package.json at ${manifestPath} has no "name" — required for {package} substitution`,
	);
});
