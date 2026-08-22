import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { checkConfiguredPaths } from '#src/doctor/checkConfiguredPaths.ts';

/** A repo root holding whichever excluded paths the case says exist. */
const setupRepo = ({ dirs = [], files = [] }: { dirs?: string[]; files?: string[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-configured-paths-'));

	for (const dir of dirs) {
		mkdirSync(join(cwd, dir), { recursive: true });
	}

	for (const file of files) {
		writeFileSync(join(cwd, file), 'excluded\n');
	}

	return cwd;
};

test('checkConfiguredPaths: emits no check at all when the key is absent', async () => {
	const cwd = setupRepo();

	// an absent key means nothing to audit, not an empty pass
	expect(await checkConfiguredPaths({ cwd, id: 'generated', fix: 'run the generator' })).toBe(undefined);
});

test('checkConfiguredPaths: passes when every path exists — a directory prefix and a plain file both count', async () => {
	const cwd = setupRepo({ dirs: ['src/gen'], files: ['schema.gql'] });

	const check = await checkConfiguredPaths({ cwd, id: 'generated', paths: ['src/gen/', 'schema.gql'], fix: 'run the generator' });

	expect(check?.status).toBe('pass');
	expect(check?.detail).toBe('2 generated path(s) exist');
	// a pass carries no fix
	expect(check?.fix).toBe(undefined);
});

test('checkConfiguredPaths: warns naming only the paths that are missing, carrying the caller-supplied fix', async () => {
	const cwd = setupRepo({ dirs: ['src/gen'] });

	const check = await checkConfiguredPaths({ cwd, id: 'generated', paths: ['src/gen/', 'schema.gql'], fix: 'run the generator once' });

	expect(check?.status).toBe('warn');
	expect(check?.detail).toBe('not found: schema.gql');
	expect(check?.fix).toBe('run the generator once');
});

test('checkConfiguredPaths: reports the vendored key under its own id, so the two audits stay distinguishable', async () => {
	const cwd = setupRepo({ dirs: ['src/common/components/ui'] });

	const check = await checkConfiguredPaths({ cwd, id: 'vendored', paths: ['src/common/components/ui/'], fix: 'restore the third-party code' });

	expect(check?.id).toBe('vendored');
	expect(check?.detail).toBe('1 vendored path(s) exist');
});

test('checkConfiguredPaths: a missing vendored path warns with the vendored fix rather than the generator one', async () => {
	const cwd = setupRepo();

	const check = await checkConfiguredPaths({ cwd, id: 'vendored', paths: ['vendor/lib/'], fix: 'restore the third-party code' });

	expect(check?.status).toBe('warn');
	expect(check?.fix).toBe('restore the third-party code');
});
