import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { resolveStandards } from '@/standards';
import { getRejectionError } from '@tests/helpers/getRejectionError';

const baseConfig: LightsoutConfig = { scripts: { check: 'true', testUnit: 'true', testCoverage: false } };

/** A temp consumer repo holding the given repo-relative files. */
const setupRepo = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-resolve-standards-'));

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(cwd, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { cwd };
};

describe('resolveStandards', () => {
	test('loads the bundled defaults when the consumer specifies nothing', async () => {
		const { cwd } = setupRepo();

		const resolved = await resolveStandards({ cwd, config: baseConfig, packages: [] });

		expect(resolved.standards).toContain('<!-- lightsout defaults: standards/code/');
		expect(resolved.testStandards).toContain('<!-- lightsout defaults: standards/tests/');
		// unspecified is a real request for the defaults, so the caller still announces it
		expect(resolved.requested).toBe(true);
	});

	test('loads nothing when both sets are explicitly disabled', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, standards: false, testStandards: false };

		const resolved = await resolveStandards({ cwd, config, packages: [] });

		expect(resolved.standards).toBe(undefined);
		expect(resolved.testStandards).toBe(undefined);
		// nothing was asked for, so there is nothing to announce
		expect(resolved.requested).toBe(false);
	});

	test('disabling the code standards leaves the test standards loaded', async () => {
		const { cwd } = setupRepo();

		const resolved = await resolveStandards({ cwd, config: { ...baseConfig, standards: false }, packages: [] });

		expect(resolved.standards).toBe(undefined);
		expect(resolved.testStandards).toContain('<!-- lightsout defaults: standards/tests/');
		expect(resolved.requested).toBe(true);
	});

	test('reads exactly the declared entries when the consumer lists its own', async () => {
		const { cwd } = setupRepo({ files: { 'docs/style.md': '# Style\nuse tabs\n' } });
		const config: LightsoutConfig = { ...baseConfig, standards: ['docs/style.md'], testStandards: false };

		const resolved = await resolveStandards({ cwd, config, packages: [] });

		expect(resolved.standards).toBe('<!-- docs/style.md -->\n# Style\nuse tabs\n');
	});

	test('a configured channel list replaces detection', async () => {
		const { cwd } = setupRepo({ files: { 'packages/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }) } });
		const config: LightsoutConfig = { ...baseConfig, standardsChannels: [] };

		const resolved = await resolveStandards({ cwd, config, packages: ['web'] });

		// react is present in the scope but the config said base only
		expect(resolved.channels).toStrictEqual([]);
		expect(resolved.configured).toBe(true);
	});

	test('channels are detected from the scoped packages when the config is silent', async () => {
		const { cwd } = setupRepo({ files: { 'packages/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }) } });

		const resolved = await resolveStandards({ cwd, config: baseConfig, packages: ['web'] });

		expect(resolved.channels).toStrictEqual(['react']);
		expect(resolved.configured).toBe(false);
	});

	test('a declared entry that does not exist is a hard error rather than a silent skip', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, standards: ['docs/missing.md'] };

		const error = await getRejectionError({ promise: resolveStandards({ cwd, config, packages: [] }) });

		expect(error.message).toContain('standards file not found');
	});
});
