import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { checkVerificationScripts } from '#src/plan/lint/checkVerificationScripts.ts';

/** A parsed plan carrying only what this check reads. */
const planWith = ({
	commands,
	paths = [],
	earlierPhaseModifyPaths = [],
	deletePaths = [],
	movePaths = [],
}: {
	commands: string[];
	paths?: string[];
	earlierPhaseModifyPaths?: string[];
	deletePaths?: string[];
	movePaths?: { from: string; to: string }[];
}): ParsedPlan => ({
	base: 'demo',
	title: 'Demo',
	variant: 'implementable',
	sections: new Map(),
	createPaths: paths,
	modifyPaths: [],
	earlierPhaseModifyPaths,
	deletePaths,
	movePaths,
	malformedMoveLines: [],
	mirrorPaths: [],
	verificationCommands: commands,
	lines: [],
});

/** A repo holding the given manifests, keyed by path relative to the root. */
const setupRepo = ({ manifests = {} }: { manifests?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verification-scripts-'));

	for (const [path, content] of Object.entries(manifests)) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}

	return { cwd, planPath: join(cwd, 'plan.md') };
};

const check = ({
	cwd,
	planPath,
	plan,
	configCommands = new Set<string>(),
	declaredScripts = new Set<string>(),
}: {
	cwd: string;
	planPath: string;
	plan: ParsedPlan;
	configCommands?: Set<string>;
	declaredScripts?: Set<string>;
}) => checkVerificationScripts({ plan, cwd, planPath, phase: 'plan.md', packagesDir: 'packages', configCommands, declaredScripts });

const rootManifest = (scripts: Record<string, string>) => ({ 'package.json': JSON.stringify({ name: 'root', scripts }) });

describe('checkVerificationScripts', () => {
	test('accepts a bare pnpm script that the root manifest declares', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc --noEmit' }) });

		expect(await check({ cwd, planPath, plan: planWith({ commands: ['pnpm check'] }) })).toStrictEqual([]);
	});

	test('flags a script no target manifest declares, naming the script and the fix', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc --noEmit' }) });

		const findings = await check({ cwd, planPath, plan: planWith({ commands: ['pnpm verify'] }) });

		expect(findings[0]?.issue).toMatch(/references package script 'verify' which is not in any target package.json/);
		expect(findings[0]?.fix).toMatch(/add 'verify' to the package.json/);
	});

	test('reads past a --filter and its selector to find the script name', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc --noEmit' }) });

		expect(await check({ cwd, planPath, plan: planWith({ commands: ['pnpm --filter api check'] }) })).toStrictEqual([]);
	});

	test('reads past a bare flag that takes no argument, which consumes one token not two', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc --noEmit' }) });

		// `--silent` swallows no selector, so the script is the very next token
		expect(await check({ cwd, planPath, plan: planWith({ commands: ['pnpm --silent check'] }) })).toStrictEqual([]);
	});

	test('resolves an explicit `run` form past its filter and selector', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc --noEmit' }) });

		expect(await check({ cwd, planPath, plan: planWith({ commands: ['pnpm --filter api run check'] }) })).toStrictEqual([]);
	});

	test('a `run` form naming an undeclared script is flagged under the parsed script name', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc --noEmit' }) });

		const findings = await check({ cwd, planPath, plan: planWith({ commands: ['npm run verify --workspace=api'] }) });

		// the workspace flag trails the script, so `verify` is what was referenced
		expect(findings[0]?.issue).toMatch(/references package script 'verify' which is not in any target package.json/);
	});

	test('a path naming no package adds no manifest to consult', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({}) });

		// neither a root-level path nor a bare `packages/` prefix names a package
		const findings = await check({ cwd, planPath, plan: planWith({ commands: ['pnpm check'], paths: ['src/thing.ts', 'packages/'] }) });

		expect(findings[0]?.issue).toMatch(/'check' which is not in any target package.json/);
	});

	test('a touched package with no manifest of its own is skipped rather than failing the check', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc' }) });

		const plan = planWith({ commands: ['pnpm check', 'pnpm build'], paths: ['packages/ghost/src/thing.ts'] });
		const findings = await check({ cwd, planPath, plan });

		// the unreadable package manifest contributes nothing, and the root
		// manifest still answers for `check`
		expect(findings.map((finding) => finding.issue)).toStrictEqual([
			"verification command 'pnpm build' references package script 'build' which is not in any target package.json",
		]);
	});

	test('a raw command with no package-manager prefix is not guessed into a finding', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({}) });

		// `tsc --noEmit` is not a package script and was never claimed to be
		expect(await check({ cwd, planPath, plan: planWith({ commands: ['tsc --noEmit'] }) })).toStrictEqual([]);
	});

	test('a config full-command override is skipped rather than parsed as a script', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({}) });

		const findings = await check({
			cwd,
			planPath,
			plan: planWith({ commands: ['pnpm nonexistent'] }),
			configCommands: new Set(['pnpm nonexistent']),
		});

		expect(findings).toStrictEqual([]);
	});

	test('a scoped script counts when the package the plan touches declares it', async () => {
		const { cwd, planPath } = setupRepo({
			manifests: { ...rootManifest({}), 'packages/api/package.json': JSON.stringify({ name: 'api', scripts: { check: 'tsc' } }) },
		});

		const plan = planWith({ commands: ['pnpm --filter api check'], paths: ['packages/api/src/thing.ts'] });

		expect(await check({ cwd, planPath, plan })).toStrictEqual([]);
	});

	test('a manifest with no scripts key contributes nothing rather than throwing', async () => {
		const { cwd, planPath } = setupRepo({ manifests: { 'package.json': JSON.stringify({ name: 'root' }) } });

		const findings = await check({ cwd, planPath, plan: planWith({ commands: ['pnpm check'] }) });

		expect(findings[0]?.issue).toMatch(/'check' which is not in any target package.json/);
	});

	test('a manifest that is not valid JSON contributes nothing rather than failing the lint', async () => {
		const { cwd, planPath } = setupRepo({ manifests: { 'package.json': '{ not json' } });

		const findings = await check({ cwd, planPath, plan: planWith({ commands: ['pnpm check'] }) });

		expect(findings.length).toBe(1);
	});

	test('a yarn script is recognised, and a yarn flag is not mistaken for one', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'tsc' }) });

		expect(await check({ cwd, planPath, plan: planWith({ commands: ['yarn check'] }) })).toStrictEqual([]);
		// a leading flag means the next token is not the script name
		expect(await check({ cwd, planPath, plan: planWith({ commands: ['yarn --version'] }) })).toStrictEqual([]);
	});

	test('a config being present never blanket-skips the check — only its own commands are overrides', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({ check: 'true' }) });

		const findings = await check({ cwd, planPath, plan: planWith({ commands: ['pnpm phantom'] }), configCommands: new Set(['pnpm ghost-script']) });

		// the override set holds the gate commands themselves, so a different
		// command still resolves as a package script and is flagged
		expect(findings.some((finding) => finding.issue.includes("'phantom'"))).toBe(true);
	});

	test('a phase whose only package-touching work is a move, a delete or an earlier-phase modify still resolves that package manifest', async () => {
		const { cwd, planPath } = setupRepo({
			manifests: {
				...rootManifest({}),
				'packages/api/package.json': JSON.stringify({ name: 'api', scripts: { 'check:api': 'tsc' } }),
				'packages/web/package.json': JSON.stringify({ name: 'web', scripts: { 'check:web': 'tsc' } }),
				'packages/cli/package.json': JSON.stringify({ name: 'cli', scripts: { 'check:cli': 'tsc' } }),
			},
		});
		const plan = planWith({
			commands: ['pnpm check:api', 'pnpm check:web', 'pnpm check:cli'],
			movePaths: [{ from: 'packages/api/src/old.ts', to: 'packages/api/src/new.ts' }],
			deletePaths: ['packages/web/src/gone.ts'],
			earlierPhaseModifyPaths: ['packages/cli/src/later.ts'],
		});

		// a relocation names no created or modified file, so a check reading only
		// those two collections would miss the package entirely and flag its script
		expect(await check({ cwd, planPath, plan })).toStrictEqual([]);
	});

	test('a script an earlier-or-same phase declares it adds resolves before any package.json has it', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({}) });

		const findings = await check({
			cwd,
			planPath,
			plan: planWith({ commands: ['pnpm check:new'] }),
			declaredScripts: new Set(['check:new']),
		});

		// the plan is what adds the script, so judging it against today's manifests
		// would refuse a phase for work it is itself specifying
		expect(findings).toStrictEqual([]);
	});

	test('a declared script covers only its own name, never every command in the plan', async () => {
		const { cwd, planPath } = setupRepo({ manifests: rootManifest({}) });

		const findings = await check({
			cwd,
			planPath,
			plan: planWith({ commands: ['pnpm check:new', 'pnpm check:other'] }),
			declaredScripts: new Set(['check:new']),
		});

		expect(findings.map((finding) => finding.issue)).toStrictEqual([
			"verification command 'pnpm check:other' references package script 'check:other' which is not in any target package.json",
		]);
	});
});
