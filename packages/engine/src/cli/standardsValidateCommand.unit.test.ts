import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { standardsValidateCommand } from '#src/cli/standardsValidateCommand.ts';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '#src/standardsPackages/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Loading a package off disk and running its checks against fixtures are two
// other modules' entry points, each covered by its own tests. What this command
// owns is which package path it resolves, the order it prints in, and how it
// ends — all observable with both stubbed.

const mockLoadStandardsPackage = jest.fn<(params: { packagePath: string }) => Promise<LoadedStandardsPackage>>();
const mockResolveDefaultStandardsPackage = jest.fn<() => string>();
const mockValidateStandardsPackage = jest.fn<(params: { pkg: LoadedStandardsPackage }) => Promise<{ problems: string[]; notes: string[] }>>();

jest.mock('#src/standardsPackages/index.ts', () => ({
	loadStandardsPackage: (params: { packagePath: string }) => mockLoadStandardsPackage(params),
	resolveDefaultStandardsPackage: () => mockResolveDefaultStandardsPackage(),
}));

jest.mock('#src/standardsCheck/index.ts', () => ({
	validateStandardsPackage: (params: { pkg: LoadedStandardsPackage }) => mockValidateStandardsPackage(params),
}));
// -------------------------

const rule = (overrides: Partial<LoadedStandardsRule> & { id: string }): LoadedStandardsRule => ({
	set: 'code',
	documentPath: 'code/style-guide/structure/module-api',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: false,
	defaultSeverity: 'advisory',
	defaultSettings: {},
	fixturesPath: `/packages/acme/${overrides.id}/fixtures`,
	...overrides,
});

const setupValidate = ({
	args = [],
	rules = [rule({ id: 'multi-export', checked: true }), rule({ id: 'premature-abstraction' })],
	problems = [],
	notes = [],
}: {
	args?: string[];
	rules?: LoadedStandardsRule[];
	problems?: string[];
	notes?: string[];
} = {}) => {
	const captured = captureCommandOutput();
	const pkg: LoadedStandardsPackage = { name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules };

	mockResolveDefaultStandardsPackage.mockReturnValue('/plugin/standards');
	mockLoadStandardsPackage.mockResolvedValue(pkg);
	mockValidateStandardsPackage.mockResolvedValue({ problems, notes });

	return { context: { flags: parseFlags({ args }), rest: [], cwd: '/repo' }, pkg, ...captured };
};

describe('standardsValidateCommand', () => {
	test('validates the bundled default package when no --package is given', async () => {
		const { context, pkg, logged, exitCodes } = setupValidate();

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockLoadStandardsPackage).toHaveBeenCalledWith({ packagePath: '/plugin/standards' });
		// the package that was loaded is the one validated — not a second read
		expect(mockValidateStandardsPackage).toHaveBeenCalledWith({ pkg });
		// the tally separates what was validated from what nothing could validate
		expect(logged).toContain('acme — 1 checked rule(s) validated, 1 judgment-only rule(s)');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('resolves a repo-relative --package against the cwd', async () => {
		const { context } = setupValidate({ args: ['--package', 'plugin/standards'] });

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockLoadStandardsPackage).toHaveBeenCalledWith({ packagePath: '/repo/plugin/standards' });
	});

	test('takes an absolute --package as it stands', async () => {
		const { context } = setupValidate({ args: ['--package', '/elsewhere/standards'] });

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockLoadStandardsPackage).toHaveBeenCalledWith({ packagePath: '/elsewhere/standards' });
	});

	test('prints the notes and then the problems, and ends red when any problem remains', async () => {
		const { context, logged, exitCodes } = setupValidate({
			notes: ['premature-abstraction: judgment-only — fixtures reserved for agent accuracy'],
			problems: ['multi-export: the fail fixture produced no finding — the check does not catch what the rule describes'],
		});

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe('ℹ premature-abstraction: judgment-only — fixtures reserved for agent accuracy');
		expect(logged[1]).toBe('✗ multi-export: the fail fixture produced no finding — the check does not catch what the rule describes');
		expect(logged).toContain('acme — 1 problem(s) across 1 checked rule(s)');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('ends green when the run produced notes but no problems', async () => {
		const { context, logged, exitCodes } = setupValidate({
			notes: ['multi-export: fixtures skipped — no typescript resolvable'],
		});

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		// a rule nothing could validate is reported, not counted against the package
		expect(logged[0]).toBe('ℹ multi-export: fixtures skipped — no typescript resolvable');
		expect(logged).toContain('acme — 1 checked rule(s) validated, 1 judgment-only rule(s)');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('reports a package it cannot load and never runs the validation', async () => {
		const { context, errors, exitCodes } = setupValidate();

		mockLoadStandardsPackage.mockRejectedValue(new Error('standards package root file not found: /plugin/standards/lightsout-standards.json'));

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['standards package root file not found: /plugin/standards/lightsout-standards.json']);
		expect(mockValidateStandardsPackage).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});
