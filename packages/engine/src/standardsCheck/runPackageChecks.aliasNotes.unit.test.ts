import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type StandardsCheckFunction, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import type { ResolvedRuleState } from '#src/standardsCheck/common/types/ResolvedRuleState.ts';
import { runPackageChecks } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';

/** A repo that declares its path aliases nowhere: no tsconfig above anything, and a manifest only when one is asked for. */
const setupUndeclaredRepo = ({ manifest, folders = ['src', 'src/feature'] }: { manifest?: string; folders?: string[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-alias-notes-'));

	for (const folder of folders) {
		mkdirSync(join(cwd, folder), { recursive: true });
		writeFileSync(join(cwd, folder, 'alpha.ts'), 'export const alpha = 1;\n');
	}

	if (manifest !== undefined) {
		writeFileSync(join(cwd, 'package.json'), manifest);
	}

	return { cwd };
};

/** A workspace repo where one package declares `imports` and a folder outside it declares nothing. */
const setupWorkspaceRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-alias-notes-workspace-'));

	mkdirSync(join(cwd, 'packages/engine/src'), { recursive: true });
	mkdirSync(join(cwd, 'tools'), { recursive: true });
	writeFileSync(join(cwd, 'packages/engine/src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'packages/engine/package.json'), JSON.stringify({ name: '@acme/engine', imports: { '#src/*': './src/*' } }));
	writeFileSync(join(cwd, 'tools/helper.ts'), 'export const helper = 2;\n');

	return { cwd };
};

/** A check that reports one finding, so an empty note list can be told apart from a rule that never ran. */
const reportingRun: StandardsCheckFunction = ({ input }) => [{ siteKey: `${input.kind}:one`, files: [{ path: 'src/alpha.ts' }], detail: 'one site' }];

const rule = ({ id, inputKind }: { id: string; inputKind: StandardsInputKind }): LoadedStandardsRule => ({
	id,
	set: 'code',
	documentPath: 'code/style-guide/structure/module-api',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: true,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: `/packages/acme/${id}/fixtures`,
	inputKind,
	run: reportingRun,
});

/** Runs the given rules as one loaded package, at the severities a repo's config would have resolved for them. */
const runChecks = ({ rules, cwd }: { rules: LoadedStandardsRule[]; cwd: string }) => {
	const pkg: LoadedStandardsPack = { name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules };
	const states = new Map<string, ResolvedRuleState>(
		rules.map((entry) => [entry.id, { severity: entry.defaultSeverity, settings: entry.defaultSettings, fromConfig: false }]),
	);

	return runPackageChecks({ cwd, packs: [pkg], states, channels: [] });
};

describe('runPackageChecks', () => {
	test('names the folders no alias declaration sits above, so a rule that stayed silent is never read as a clean one', async () => {
		const { cwd } = setupUndeclaredRepo();

		const { notes } = await runChecks({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText })] });

		expect(notes).toStrictEqual([
			'no package.json with imports and no tsconfig above 2 folder(s) — path aliases are unknown there, so the barrel and import rules stayed silent rather than guess: src, src/feature',
		]);
	});

	test('says nothing about aliases when a manifest declares them, since imports answers the question paths does', async () => {
		const { cwd } = setupUndeclaredRepo({ manifest: JSON.stringify({ name: 'acme-repo', imports: { '#src/*': './src/*' } }) });

		const { findings, notes } = await runChecks({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText })] });

		expect(notes).toStrictEqual([]);
		// the rule really did run — an empty note list means answered, not skipped
		expect(findings.map((finding) => finding.rule)).toStrictEqual(['multi-export']);
	});

	test('names the folders anyway when the manifest declares no imports, since every package ships a manifest', async () => {
		const { cwd } = setupUndeclaredRepo({ manifest: JSON.stringify({ name: 'acme-repo', dependencies: {} }) });

		const { notes } = await runChecks({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText })] });

		// counting a manifest's mere presence as an answer would report the whole
		// repo covered and this note would never fire again
		expect(notes).toStrictEqual([
			'no package.json with imports and no tsconfig above 2 folder(s) — path aliases are unknown there, so the barrel and import rules stayed silent rather than guess: src, src/feature',
		]);
	});

	test.each([
		{ shape: 'text that will not parse', manifest: '{ "imports": { "#src/*"' },
		{ shape: 'a body that is not an object', manifest: '5' },
		{ shape: 'a body that parsed to null', manifest: 'null' },
		{ shape: 'an imports of null', manifest: '{ "imports": null }' },
		{ shape: 'an imports that is a list', manifest: '{ "imports": [] }' },
		{ shape: 'an imports that is a single string', manifest: '{ "imports": "./src/*" }' },
	])('names the folders anyway for a manifest carrying $shape, which no alias can be read from', async ({ manifest }) => {
		const { cwd } = setupUndeclaredRepo({ manifest });

		const { notes } = await runChecks({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText })] });

		// only a manifest whose `imports` is an actual map of alias to target has
		// answered the question; anything else is credited to nobody, so the
		// folders stay uncovered rather than being reported as declared
		expect(notes).toStrictEqual([
			'no package.json with imports and no tsconfig above 2 folder(s) — path aliases are unknown there, so the barrel and import rules stayed silent rather than guess: src, src/feature',
		]);
	});

	test('names only the folders outside the package whose manifest answered, not every folder in the repo', async () => {
		const { cwd } = setupWorkspaceRepo();

		const { notes } = await runChecks({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText })] });

		// the manifest sits at the package root, not the repo root, so the answer
		// has to be found by walking up from the file rather than read once
		expect(notes).toStrictEqual([
			'no package.json with imports and no tsconfig above 1 folder(s) — path aliases are unknown there, so the barrel and import rules stayed silent rather than guess: tools',
		]);
	});

	test('leaves the alias question unasked when no file-text rule ran, since no other pass depends on the answer', async () => {
		const { cwd } = setupUndeclaredRepo();

		const { findings, notes } = await runChecks({ cwd, rules: [rule({ id: 'dependency-drift', inputKind: StandardsInputKind.FileList })] });

		expect(notes).toStrictEqual([]);
		expect(findings.map((finding) => finding.rule)).toStrictEqual(['dependency-drift']);
	});

	test('names only the first five uncovered folders, because a note carrying every one of them is a note nobody reads', async () => {
		const { cwd } = setupUndeclaredRepo({ folders: ['src/f1', 'src/f2', 'src/f3', 'src/f4', 'src/f5', 'src/f6'] });

		const { notes } = await runChecks({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText })] });

		expect(notes).toStrictEqual([
			'no package.json with imports and no tsconfig above 6 folder(s) — path aliases are unknown there, so the barrel and import rules stayed silent rather than guess: src/f1, src/f2, src/f3, src/f4, src/f5, …',
		]);
	});
});
