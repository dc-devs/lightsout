import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind, StandardsSeverity, type FileListInput, type StandardsCheckInput, type StandardsCheckRun } from '@/contracts';
import type { ResolvedRuleState } from '@/standardsCheck/common/types/ResolvedRuleState';
import { runPackageChecks } from '@/standardsCheck';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '@/standardsPackages';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import { linkTypescript } from '@tests/helpers/linkTypescript';

/** A repo the checks run against. `typescript` decides whether the compiler-backed kinds can run at all. */
const setupRepo = ({ typescript = false }: { typescript?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-package-checks-'));

	mkdirSync(join(cwd, 'src/feature'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'src/feature/internal.ts'), 'export const internal = 2;\n');
	writeFileSync(join(cwd, 'src/alpha.unit.test.ts'), "test('alpha', () => {});\n");

	if (typescript) {
		mkdirSync(join(cwd, 'node_modules'), { recursive: true });
		symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(cwd, 'node_modules/typescript'), 'dir');
	}

	return { cwd };
};

/** A repo whose workspace packages sit somewhere other than the `packages/` default — the config's `packagesDir`. */
const setupWorkspaceRepo = ({ typescript = false }: { typescript?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-package-checks-apps-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	mkdirSync(join(cwd, 'apps/web'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'apps/web/package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));

	if (typescript) {
		// the only typescript in the repo, and it sits inside the workspace package
		linkTypescript({ dir: join(cwd, 'apps/web') });
	}

	return { cwd };
};

const rule = (overrides: Partial<LoadedStandardsRule> & { id: string }): LoadedStandardsRule => ({
	set: 'code',
	documentPath: 'code/style-guide/structure/module-api',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: overrides.run !== undefined,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: `/packages/acme/${overrides.id}/fixtures`,
	...overrides,
});

/** A check that reports one finding per source file and records what it was handed. */
const recordingRun = ({ calls }: { calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> }): StandardsCheckRun => {
	return ({ input, settings }) => {
		calls.push({ input, settings });

		return [{ siteKey: `${input.kind}:one`, files: [{ path: 'src/alpha.ts' }], detail: 'one site' }];
	};
};

/** The first input a check was handed, narrowed to the kind whose path lists the test reads. */
const fileListInput = ({ calls }: { calls: Array<{ input: StandardsCheckInput }> }): FileListInput => {
	const input = calls[0]?.input;

	if (input?.kind !== StandardsInputKind.FileList) {
		throw new Error(`expected a file-list input, got ${String(input?.kind)}`);
	}

	return input;
};

const setupRun = ({
	rules,
	cwd,
	channels = [],
	severities = {},
	packagesDir,
	path,
	exclude,
	onProgress,
}: {
	rules: LoadedStandardsRule[];
	cwd: string;
	channels?: string[];
	severities?: Record<string, StandardsSeverity>;
	packagesDir?: string;
	path?: string;
	exclude?: string[];
	onProgress?: (message: string) => void;
}) => {
	const pkg: LoadedStandardsPackage = { name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules };
	const states = new Map<string, ResolvedRuleState>(
		rules.map((entry) => [entry.id, { severity: severities[entry.id] ?? entry.defaultSeverity, settings: entry.defaultSettings, fromConfig: false }]),
	);

	return runPackageChecks({ cwd, packages: [pkg], states, channels, packagesDir, path, exclude, onProgress });
};

describe('runPackageChecks', () => {
	test('stamps each finding with the rule id it came from and the severity the repo resolved', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		const { findings } = await setupRun({
			cwd,
			rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }), defaultSeverity: StandardsSeverity.Advisory })],
			severities: { 'multi-export': StandardsSeverity.Blocking },
		});

		// the check never names either — the folder owns the id, the config the severity
		expect(findings).toStrictEqual([
			{ rule: 'multi-export', severity: StandardsSeverity.Blocking, siteKey: 'file-text:one', files: [{ path: 'src/alpha.ts' }], detail: 'one site' },
		]);
	});

	test('builds one input per kind and hands the very same one to every rule that asked for it', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		await setupRun({
			cwd,
			rules: [
				rule({ id: 'first', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }) }),
				rule({ id: 'second', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }) }),
			],
		});

		expect(calls).toHaveLength(2);
		// one build, one read of every file, however many rules want the text
		expect(calls[0]?.input).toBe(calls[1]?.input);
	});

	test('gives each clone rule its own detection, because the detector runs on that rule settings', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		await setupRun({
			cwd,
			rules: [
				rule({ id: 'clone', inputKind: StandardsInputKind.CloneSpans, run: recordingRun({ calls }), defaultSettings: { minTokens: 50 } }),
				rule({ id: 'clone-strict', inputKind: StandardsInputKind.CloneSpans, run: recordingRun({ calls }), defaultSettings: { minTokens: 200 } }),
			],
		});

		expect(calls[0]?.input).not.toBe(calls[1]?.input);
		expect(calls[0]?.settings).toStrictEqual({ minTokens: 50 });
		expect(calls[1]?.settings).toStrictEqual({ minTokens: 200 });
	});

	test('runs nothing for a rule the repo switched off', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		const { findings } = await setupRun({
			cwd,
			rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }) })],
			severities: { 'multi-export': StandardsSeverity.Off },
		});

		// off is a configuration state: the check is never even called
		expect(calls).toHaveLength(0);
		expect(findings).toStrictEqual([]);
	});

	test('ignores a judgment-only rule, which ships no check to run', async () => {
		const { cwd } = setupRepo();

		const { findings, notes } = await setupRun({ cwd, rules: [rule({ id: 'premature-abstraction' })] });

		expect(findings).toStrictEqual([]);
		expect(notes).toStrictEqual([]);
	});

	test('runs a framework rule only when its channel is active for the repo', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];
		const reactRule = rule({ id: 'hook-deps', channel: 'react', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }) });

		const inactive = await setupRun({ cwd, rules: [reactRule], channels: [] });
		const active = await setupRun({ cwd, rules: [reactRule], channels: ['react'] });

		// a document out of play contributes no prose, so it contributes no checks
		expect(inactive.findings).toStrictEqual([]);
		expect(active.findings).toHaveLength(1);
	});

	test('skips the compiler-backed rules with one note naming them when no typescript resolves', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		const { findings, notes } = await setupRun({
			cwd,
			rules: [
				rule({ id: 'dead-export', inputKind: StandardsInputKind.SyntaxTree, run: recordingRun({ calls }) }),
				rule({ id: 'module-boundary', inputKind: StandardsInputKind.ImportGraph, run: recordingRun({ calls }) }),
				rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }) }),
			],
		});

		expect(notes).toStrictEqual(['dead-export, module-boundary skipped — no typescript resolvable from the target repo']);
		// the rules that need no compiler still run
		expect(findings.map((finding) => finding.rule)).toStrictEqual(['multi-export']);
	});

	test('runs the compiler-backed rules when the repo has a typescript to borrow', async () => {
		const { cwd } = setupRepo({ typescript: true });
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		const { findings, notes } = await setupRun({
			cwd,
			rules: [rule({ id: 'dead-export', inputKind: StandardsInputKind.SyntaxTree, run: recordingRun({ calls }) })],
		});

		expect(notes).toStrictEqual([]);
		expect(findings.map((finding) => finding.rule)).toStrictEqual(['dead-export']);
	});

	test('reads each workspace manifest from the packages dir the repo configured', async () => {
		const { cwd } = setupWorkspaceRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		await setupRun({
			cwd,
			rules: [rule({ id: 'dependency-drift', inputKind: StandardsInputKind.FileList, run: recordingRun({ calls }) })],
			packagesDir: 'apps',
		});

		// a rule asking "does this app use React?" gets an answer only if the
		// engine looked where the repo keeps its packages
		expect(fileListInput({ calls }).dependencies.get('apps/web')).toStrictEqual(['react']);
	});

	test('borrows a workspace package typescript from the configured packages dir', async () => {
		const { cwd } = setupWorkspaceRepo({ typescript: true });
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		const { findings, notes } = await setupRun({
			cwd,
			rules: [rule({ id: 'dead-export', inputKind: StandardsInputKind.SyntaxTree, run: recordingRun({ calls }) })],
			packagesDir: 'apps',
		});

		// without the configured dir the compiler-backed tier would sit out every
		// run in a monorepo that hoists nothing to its root
		expect(notes).toStrictEqual([]);
		expect(findings.map((finding) => finding.rule)).toStrictEqual(['dead-export']);
	});

	test('scopes the checked files to --path while keeping the whole repo as reference', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		await setupRun({
			cwd,
			rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileList, run: recordingRun({ calls }) })],
			path: 'src/feature',
		});

		const input = fileListInput({ calls });

		expect(input.files).toStrictEqual(['src/feature/internal.ts']);
		// reference files stay unfiltered — a consumer outside the scope still counts
		expect(input.referenceFiles).toContain('src/alpha.ts');
	});

	test('drops the excluded paths a repo declared generated', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];

		await setupRun({
			cwd,
			rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileList, run: recordingRun({ calls }) })],
			exclude: ['src/feature'],
		});

		expect(fileListInput({ calls }).referenceFiles).not.toContain('src/feature/internal.ts');
	});

	test('reports progress as the file count first and then each input kind it ran', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];
		const messages: string[] = [];

		await setupRun({
			cwd,
			rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }) })],
			onProgress: (message) => messages.push(message),
		});

		expect(messages).toStrictEqual(['checking 2 source file(s) and 1 test file(s)', 'file-text: done']);
	});

	test('names the rule when its check returns something that is not a list of findings', async () => {
		const { cwd } = setupRepo();
		const brokenRun = (() => 'not findings at all') as unknown as StandardsCheckRun;

		const error = await getRejectionError({
			promise: setupRun({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: brokenRun })] }),
		});

		// a broken check is a package bug, not a finding
		expect(error.message).toContain('standards rule "multi-export" returned something that is not a list of findings');
	});

	test('names the offending field when a check returns a finding that is missing one', async () => {
		const { cwd } = setupRepo();
		const shortRun = (() => [{ siteKey: 'a-site', files: [{ path: 'src/alpha.ts' }] }]) as unknown as StandardsCheckRun;

		const error = await getRejectionError({
			promise: setupRun({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: shortRun })] }),
		});

		// the author has to be told which finding and which field, not just "invalid"
		expect(error.message).toContain('standards rule "multi-export"');
		expect(error.message).toContain('0.detail');
	});

	test('names the rule when its check throws', async () => {
		const { cwd } = setupRepo();
		const throwingRun: StandardsCheckRun = () => {
			throw new Error('cannot parse that');
		};

		const error = await getRejectionError({
			promise: setupRun({ cwd, rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: throwingRun })] }),
		});

		expect(error.message).toBe('standards rule "multi-export" threw while checking: cannot parse that');
	});

	test('leaves a rule out when the run was handed no resolved state for it', async () => {
		const { cwd } = setupRepo();
		const calls: Array<{ input: StandardsCheckInput; settings: Record<string, number> }> = [];
		const pkg: LoadedStandardsPackage = {
			name: 'acme',
			formatVersion: 1,
			rootPath: '/packages/acme',
			documents: [],
			rules: [rule({ id: 'multi-export', inputKind: StandardsInputKind.FileText, run: recordingRun({ calls }) })],
		};

		const { findings } = await runPackageChecks({ cwd, packages: [pkg], states: new Map(), channels: [] });

		// severity is policy; with none resolved there is nothing to report at
		expect(findings).toStrictEqual([]);
	});
});
