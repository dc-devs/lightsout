import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { loadPlanningStandards } from '@/cli/plan';
import type { LightsoutConfig } from '@/contracts';

/** A one-rule standards package to write inside the repo, in the code tree unless told otherwise. */
interface StandardsPackage {
	at: string;
	name: string;
	ruleId: string;
	prose: string;
	set?: 'code' | 'tests';
}

const writeStandardsPackage = ({ cwd, at, name, ruleId, prose, set = 'code' }: StandardsPackage & { cwd: string }) => {
	const packagePath = join(cwd, at);
	const rulePath = `${set}/demo/01-${ruleId}`;
	const files: Record<string, string> = {
		'lightsout-standards.json': `{ "name": "${name}", "formatVersion": 1 }\n`,
		[`${set}/demo/document.md`]: '# Demo\n\nThe document the rule argues under.\n',
		[`${rulePath}/rule.md`]: `---\nsummary: a rule the package declares\n---\n\n${prose}\n`,
		[`${rulePath}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
		[`${rulePath}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
	};

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packagePath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}
};

/**
 * A consumer repo whose manifest carries the given dependencies — the signal
 * framework channels are detected from — holding the declared standards
 * packages.
 */
const setupStandards = ({ dependencies, packages = [] }: { dependencies?: Record<string, string>; packages?: StandardsPackage[] } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-standards-'));

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', dependencies: dependencies ?? {} }));

	for (const declared of packages) {
		writeStandardsPackage({ cwd, ...declared });
	}

	return { cwd, ...captured };
};

/** The gate config every LightsoutConfig needs, so each case only states the standards keys it is about. */
const configWith = (fields: Partial<LightsoutConfig>): LightsoutConfig => ({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ...fields });

test('loadPlanningStandards: with no config it loads the shipped default package, base channel only', async () => {
	const { cwd, logged } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: undefined });

	expect(standards ?? '').toMatch(/<!-- lightsout-defaults: code\/architecture\/folder-structure -->/);
	// no framework channel activates without a signal dependency
	expect((standards ?? '').includes('code/architecture/react')).toBeFalsy();
	expect(logged).toStrictEqual([]);
});

test('loadPlanningStandards: standards turned off explicitly loads nothing at all', async () => {
	const { cwd, logged } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: configWith({ 'standards-packages': false }) });

	expect(standards).toBe(undefined);
	expect(logged).toStrictEqual([]);
});

test('loadPlanningStandards: planning gets the code set only — the test tree is not its business', async () => {
	const { cwd } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: configWith({}) });

	expect((standards ?? '').includes('<!-- lightsout-defaults: tests/')).toBeFalsy();
});

test('loadPlanningStandards: a react dependency in the consumer manifest activates the react channel', async () => {
	const { cwd } = setupStandards({ dependencies: { react: '^19.0.0' } });

	const standards = await loadPlanningStandards({ cwd, config: configWith({}) });

	expect(standards ?? '').toMatch(/<!-- lightsout-defaults: code\/architecture\/react -->/);
});

test('loadPlanningStandards: configured channels override detection — react docs load with no react dependency present', async () => {
	const { cwd } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: configWith({ 'standards-channels': ['react'] }) });

	expect(standards ?? '').toMatch(/<!-- lightsout-defaults: code\/architecture\/react -->/);
});

test('loadPlanningStandards: several declared packages all reach the plan, in config order, one blank line apart', async () => {
	const { cwd, logged } = setupStandards({
		packages: [
			{ at: 'standards/house', name: 'house', ruleId: 'house-rule', prose: 'House prose.' },
			{ at: 'standards/team', name: 'team', ruleId: 'team-rule', prose: 'Team prose.' },
		],
	});

	const standards = await loadPlanningStandards({ cwd, config: configWith({ 'standards-packages': ['standards/house', 'standards/team'] }) });

	// the second package's text picks up where the first one ends, a blank line on
	expect(standards ?? '').toContain('<!-- house: code/demo -->');
	expect(standards ?? '').toContain('House prose.\n\n<!-- team: code/demo -->');
	expect(standards ?? '').toContain('Team prose.');
	expect(logged).toStrictEqual([]);
});

test('loadPlanningStandards: a package carrying only a test tree contributes nothing, and that is not a failure', async () => {
	const { cwd, logged } = setupStandards({
		packages: [{ at: 'standards/tests-only', name: 'tests-only', ruleId: 'mock-prefix', prose: 'Name mocks so they read as mocks.', set: 'tests' }],
	});

	const standards = await loadPlanningStandards({ cwd, config: configWith({ 'standards-packages': ['standards/tests-only'] }) });

	// the package loaded fine — it simply has no code set, so planning gets nothing and nothing is narrated
	expect(standards).toBe(undefined);
	expect(logged).toStrictEqual([]);
});

test('loadPlanningStandards: a declared standards package that does not exist is non-fatal — it narrates and returns nothing', async () => {
	const { cwd, logged, errors } = setupStandards();

	const standards = await loadPlanningStandards({ cwd, config: configWith({ 'standards-packages': ['missing-standards'] }) });

	// planning continues without standards rather than dying on them
	expect(standards).toBe(undefined);
	expect(logged.length).toBe(1);
	expect(logged[0] ?? '').toMatch(/^standards not loaded \(non-fatal\): standards package root file not found: .*missing-standards/);
	expect(errors).toStrictEqual([]);
});
