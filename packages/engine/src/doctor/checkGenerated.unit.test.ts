import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { checkGenerated } from '@/doctor/checkGenerated';

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A repo root holding whichever generated paths the case says exist. */
const setupRepo = ({ dirs = [], files = [] }: { dirs?: string[]; files?: string[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-generated-'));

	for (const dir of dirs) {
		mkdirSync(join(cwd, dir), { recursive: true });
	}

	for (const file of files) {
		writeFileSync(join(cwd, file), 'generated\n');
	}

	return cwd;
};

describe('checkGenerated', () => {
	test('emits no check at all when the config names no generated paths', async () => {
		const cwd = setupRepo();

		// no `generated` key means nothing to audit, not an empty pass
		expect(await checkGenerated({ cwd, config: { gates } })).toBe(undefined);
	});

	test('passes when every configured path exists — a directory prefix and a plain file both count', async () => {
		const cwd = setupRepo({ dirs: ['src/gen'], files: ['schema.gql'] });

		const check = await checkGenerated({ cwd, config: { gates, generated: ['src/gen/', 'schema.gql'] } });

		expect(check?.status).toBe('pass');
		expect(check?.detail).toBe('2 generated path(s) exist');
		// a pass carries no fix
		expect(check?.fix).toBe(undefined);
	});

	test('warns naming only the paths that are missing, with the generator as the fix', async () => {
		const cwd = setupRepo({ dirs: ['src/gen'] });

		const check = await checkGenerated({ cwd, config: { gates, generated: ['src/gen/', 'schema.gql'] } });

		expect(check?.status).toBe('warn');
		expect(check?.detail ?? '').toMatch(/schema\.gql/);
		// existing generated path not flagged
		expect((check?.detail ?? '').includes('src/gen')).toBeFalsy();
		expect(check?.fix ?? '').toMatch(/generator/);
	});
});
