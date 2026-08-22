import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { standardsValidateCommand } from '#src/cli/standardsValidateCommand.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Loading a pack off disk and running its checks against fixtures are two
// other modules' entry points, each covered by its own tests. What this command
// owns is which pack path it resolves, the order it prints in, and how it
// ends — all observable with both stubbed.

const mockLoadStandardsPack = jest.fn<(params: { packPath: string }) => Promise<LoadedStandardsPack>>();
const mockResolveDefaultStandardsPack = jest.fn<() => string>();
const mockValidateStandardsPack = jest.fn<(params: { pack: LoadedStandardsPack }) => Promise<{ problems: string[]; notes: string[] }>>();

jest.mock('#src/standardsPacks/index.ts', () => ({
	readStandardsPack: (params: { packPath: string }) => mockLoadStandardsPack(params),
	resolveDefaultStandardsPack: () => mockResolveDefaultStandardsPack(),
}));

jest.mock('#src/standardsCheck/index.ts', () => ({
	validateStandardsPack: (params: { pack: LoadedStandardsPack }) => mockValidateStandardsPack(params),
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
	const pack: LoadedStandardsPack = { name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules };

	mockResolveDefaultStandardsPack.mockReturnValue('/plugin/standards');
	mockLoadStandardsPack.mockResolvedValue(pack);
	mockValidateStandardsPack.mockResolvedValue({ problems, notes });

	return { context: { flags: parseFlags({ args }), rest: [], cwd: '/repo' }, pack, ...captured };
};

describe('standardsValidateCommand', () => {
	test('validates the bundled default pack when no --pack is given', async () => {
		const { context, pack, logged, exitCodes } = setupValidate();

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockLoadStandardsPack).toHaveBeenCalledWith({ packPath: '/plugin/standards' });
		// the pack that was loaded is the one validated — not a second read
		expect(mockValidateStandardsPack).toHaveBeenCalledWith({ pack });
		// the tally separates what was validated from what nothing could validate
		expect(logged).toContain('acme — 1 checked rule(s) validated, 1 judgment-only rule(s)');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('resolves a repo-relative --pack against the cwd', async () => {
		const { context } = setupValidate({ args: ['--pack', 'plugin/standards'] });

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockLoadStandardsPack).toHaveBeenCalledWith({ packPath: '/repo/plugin/standards' });
	});

	test('takes an absolute --pack as it stands', async () => {
		const { context } = setupValidate({ args: ['--pack', '/elsewhere/standards'] });

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockLoadStandardsPack).toHaveBeenCalledWith({ packPath: '/elsewhere/standards' });
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

		// a rule nothing could validate is reported, not counted against the pack
		expect(logged[0]).toBe('ℹ multi-export: fixtures skipped — no typescript resolvable');
		expect(logged).toContain('acme — 1 checked rule(s) validated, 1 judgment-only rule(s)');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('reports a pack it cannot load and never runs the validation', async () => {
		const { context, errors, exitCodes } = setupValidate();

		mockLoadStandardsPack.mockRejectedValue(new Error('standards pack root file not found: /plugin/standards/lightsout-standards.json'));

		await expect(standardsValidateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['standards pack root file not found: /plugin/standards/lightsout-standards.json']);
		expect(mockValidateStandardsPack).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});
