import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { loadPlanningStandards } from '@/cli/plan/loadPlanningStandards';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

/** A consumer repo whose manifest carries the given dependencies — the signal framework channels are detected from. */
const setupStandards = ({ dependencies }: { dependencies?: Record<string, string> } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-standards-'));

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', dependencies: dependencies ?? {} }));

	return { cwd, ...captured };
};

/** The gate config every LightsoutConfig needs, so each case only states the standards keys it is about. */
const configWith = (fields: Partial<LightsoutConfig>): LightsoutConfig => ({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, ...fields });

test('loadPlanningStandards: with no config it loads the bundled code defaults, base channel only', async () => {
	const { cwd, logged } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: undefined });

	expect(standards ?? '').toMatch(/<!-- lightsout defaults: standards\/code\/architecture\/folder-structure\.md -->/);
	// no framework channel activates without a signal dependency
	expect((standards ?? '').includes('standards/code/architecture/react/')).toBeFalsy();
	expect(logged).toStrictEqual([]);
});

test('loadPlanningStandards: standards turned off explicitly loads nothing at all', async () => {
	const { cwd, logged } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: configWith({ standards: false }) });

	expect(standards).toBe(undefined);
	expect(logged).toStrictEqual([]);
});

test('loadPlanningStandards: a react dependency in the consumer manifest activates the react channel', async () => {
	const { cwd } = setupStandards({ dependencies: { react: '^19.0.0' } });

	const standards = await loadPlanningStandards({ cwd, config: configWith({}) });

	expect(standards ?? '').toMatch(/<!-- lightsout defaults: standards\/code\/architecture\/react\/architecture-decisions\.md -->/);
});

test('loadPlanningStandards: configured channels override detection — react docs load with no react dependency present', async () => {
	const { cwd } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: configWith({ standardsChannels: ['react'] }) });

	expect(standards ?? '').toMatch(/<!-- lightsout defaults: standards\/code\/architecture\/react\/architecture-decisions\.md -->/);
});

test('loadPlanningStandards: a declared standards path that does not exist is non-fatal — it narrates and returns nothing', async () => {
	const { cwd, logged, errors } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: configWith({ standards: ['missing-standards.md'] }) });

	// planning continues without standards rather than dying on them
	expect(standards).toBe(undefined);
	expect(logged.length).toBe(1);
	expect(logged[0] ?? '').toMatch(/^standards not loaded \(non-fatal\): standards file not found: .*missing-standards\.md$/);
	expect(errors).toStrictEqual([]);
});
