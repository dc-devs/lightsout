import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolvePackageManifest } from '#src/common/utils/resolvePackageManifest.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

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

	expect(manifest).toStrictEqual({ name: '@acme/backend-api', scripts: { check: 'tsc -p .', 'test:unit': 'jest' } });
});

test('resolvePackageManifest: a package.json with no scripts block resolves to an empty scripts map', async () => {
	const { cwd } = setupPackage({ raw: JSON.stringify({ name: '@acme/infra' }) });

	const manifest = await resolvePackageManifest({ cwd, packagesDir: 'packages', packageDir: 'api' });

	// a scriptless package is a valid package, and scoped gates read an empty map
	// to decide what to skip
	expect(manifest).toStrictEqual({ name: '@acme/infra', scripts: {} });
});

test('resolvePackageManifest: a declared package with no package.json is a hard error naming the path', async () => {
	const { cwd, manifestPath } = setupPackage();

	const error = await getRejectionError({ promise: resolvePackageManifest({ cwd, packagesDir: 'packages', packageDir: 'api' }) });

	expect(error.message).toBe(`declared package 'api' has no package.json at ${manifestPath}`);
});

test('resolvePackageManifest: a nameless package.json is a hard error — the engine never guesses a filter', async () => {
	const { cwd, manifestPath } = setupPackage({ raw: JSON.stringify({ version: '1.0.0', scripts: { check: 'tsc' } }) });

	const error = await getRejectionError({ promise: resolvePackageManifest({ cwd, packagesDir: 'packages', packageDir: 'api' }) });

	expect(error.message).toBe(`package.json at ${manifestPath} has no "name" — required for {package} substitution`);
});
