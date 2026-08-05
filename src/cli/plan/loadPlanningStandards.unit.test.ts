import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { LightsoutConfig } from '@/contracts';
import { loadPlanningStandards } from '@/cli/plan/loadPlanningStandards';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

/** A consumer repo whose manifest carries the given dependencies — the signal framework channels are detected from. */
const setupStandards = ({ t, dependencies }: { t: TestContext; dependencies?: Record<string, string> }) => {
	const captured = captureCommandOutput({ t });
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-standards-'));

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', dependencies: dependencies ?? {} }));

	return { cwd, ...captured };
};

/** The gate config every LightsoutConfig needs, so each case only states the standards keys it is about. */
const configWith = (fields: Partial<LightsoutConfig>): LightsoutConfig => ({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, ...fields });

test('loadPlanningStandards: with no config it loads the bundled code defaults, base channel only', async (t) => {
	const { cwd, logged } = setupStandards({ t });

	const standards = await loadPlanningStandards({ cwd, config: undefined });

	assert.match(standards ?? '', /<!-- lightsout defaults: standards\/code\/architecture\/folder-structure\.md -->/);
	assert.ok(!(standards ?? '').includes('standards/code/architecture/react/'), 'no framework channel activates without a signal dependency');
	assert.deepEqual(logged, []);
});

test('loadPlanningStandards: standards turned off explicitly loads nothing at all', async (t) => {
	const { cwd, logged } = setupStandards({ t });

	const standards = await loadPlanningStandards({ cwd, config: configWith({ standards: false }) });

	assert.equal(standards, undefined);
	assert.deepEqual(logged, []);
});

test('loadPlanningStandards: a react dependency in the consumer manifest activates the react channel', async (t) => {
	const { cwd } = setupStandards({ t, dependencies: { react: '^19.0.0' } });

	const standards = await loadPlanningStandards({ cwd, config: configWith({}) });

	assert.match(standards ?? '', /<!-- lightsout defaults: standards\/code\/architecture\/react\/architecture-decisions\.md -->/);
});

test('loadPlanningStandards: configured channels override detection — react docs load with no react dependency present', async (t) => {
	const { cwd } = setupStandards({ t });

	const standards = await loadPlanningStandards({ cwd, config: configWith({ standardsChannels: ['react'] }) });

	assert.match(standards ?? '', /<!-- lightsout defaults: standards\/code\/architecture\/react\/architecture-decisions\.md -->/);
});

test('loadPlanningStandards: a declared standards path that does not exist is non-fatal — it narrates and returns nothing', async (t) => {
	const { cwd, logged, errors } = setupStandards({ t });

	const standards = await loadPlanningStandards({ cwd, config: configWith({ standards: ['missing-standards.md'] }) });

	assert.equal(standards, undefined, 'planning continues without standards rather than dying on them');
	assert.equal(logged.length, 1);
	assert.match(logged[0] ?? '', /^standards not loaded \(non-fatal\): standards file not found: .*missing-standards\.md$/);
	assert.deepEqual(errors, []);
});
