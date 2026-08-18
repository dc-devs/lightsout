import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { checkUserEvent } from '@/doctor/checkUserEvent';
import type { PackageDir } from '@/doctor/common/types/PackageDir';

/** Package directories holding the given manifests, keyed by package label. */
const setupPackages = ({ manifests }: { manifests: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-user-event-'));
	const packageDirs: PackageDir[] = [];

	for (const [label, manifest] of Object.entries(manifests)) {
		const dir = join(cwd, label);

		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'package.json'), manifest);
		packageDirs.push({ label, dir });
	}

	return packageDirs;
};

describe('checkUserEvent', () => {
	test('notes a package with @testing-library/react but no user-event — and stays silent for packages with both or neither', async () => {
		const packageDirs = setupPackages({
			manifests: {
				'web-app': JSON.stringify({ name: '@acme/web-app', devDependencies: { '@testing-library/react': '^16.0.0' } }),
				widget: JSON.stringify({
					name: '@acme/widget',
					devDependencies: { '@testing-library/preact': '^3.0.0', '@testing-library/user-event': '^14.0.0' },
				}),
				api: JSON.stringify({ name: '@acme/api' }),
			},
		});

		const check = await checkUserEvent({ packageDirs });

		// a recommendation, not a defect
		expect(check?.status).toBe('note');
		expect(check?.detail ?? '').toMatch(/web-app/);
		// package already on user-event not flagged
		expect((check?.detail ?? '').includes('widget')).toBeFalsy();
		// package without testing-library not flagged
		expect((check?.detail ?? '').includes('api')).toBeFalsy();
	});

	test('says nothing at all when no package is missing user-event', async () => {
		const packageDirs = setupPackages({ manifests: { api: JSON.stringify({ name: '@acme/api' }) } });

		expect(await checkUserEvent({ packageDirs })).toBe(undefined);
	});

	test('skips an unparseable manifest and keeps auditing the rest', async () => {
		const packageDirs = setupPackages({
			manifests: {
				root: '{ "name": "root",\n',
				'web-app': JSON.stringify({ name: '@acme/web-app', devDependencies: { '@testing-library/react': '^16.0.0' } }),
			},
		});

		const check = await checkUserEvent({ packageDirs });

		// a manifest that will not parse is skipped, not fatal
		expect(check?.status).toBe('note');
		expect(check?.detail ?? '').toMatch(/web-app/);
		expect((check?.detail ?? '').includes('root')).toBeFalsy();
	});

	test('skips a manifest whose dependency fields have the wrong shape', async () => {
		const packageDirs = setupPackages({
			manifests: {
				root: JSON.stringify({ name: 'root', devDependencies: ['@testing-library/react'] }),
				'web-app': JSON.stringify({ name: '@acme/web-app', devDependencies: { '@testing-library/react': '^16.0.0' } }),
			},
		});

		const check = await checkUserEvent({ packageDirs });

		// a manifest that fails the dependency schema is skipped, not read anyway
		expect(check?.status).toBe('note');
		expect(check?.detail ?? '').toMatch(/web-app/);
		expect((check?.detail ?? '').includes('root')).toBeFalsy();
	});

	test('a package directory with no manifest contributes nothing rather than failing', async () => {
		const check = await checkUserEvent({ packageDirs: [{ label: 'ghost', dir: '/lightsout/no/such/package' }] });

		expect(check).toBe(undefined);
	});
});
