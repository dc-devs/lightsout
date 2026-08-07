import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { checkVerificationScripts } from '@/plan/checkVerificationScripts';
import type { ParsedPlan } from '@/plan/common/types/ParsedPlan';

/** A parsed plan carrying only what this check reads. */
const planWith = ({ commands, paths = [] }: { commands: string[]; paths?: string[] }): ParsedPlan => ({
	base: 'demo',
	title: 'Demo',
	variant: 'implementable',
	sections: new Map(),
	createPaths: paths,
	modifyPaths: [],
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

const check = ({ cwd, planPath, plan, configCommands = new Set<string>() }: { cwd: string; planPath: string; plan: ParsedPlan; configCommands?: Set<string> }) =>
	checkVerificationScripts({ plan, cwd, planPath, packagesDir: 'packages', configCommands });

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
});
