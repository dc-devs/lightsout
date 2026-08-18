import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { planVerifyFactsCommand } from '@/cli/plan';

// verify-facts is deterministic — no agent — so the arrangement is a real
// consumer repo whose authored facts claim one real and one missing path plus
// one real and one missing script: the mixed case the command must warn about
// while still exiting 0.
const setupVerifyFacts = ({ args, authored }: { args: string[]; authored?: Record<string, unknown> }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-facts-command-'));
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc --noEmit' } }));
	writeFileSync(join(cwd, 'src', 'real.ts'), 'export const real = true;\n');

	if (authored) {
		mkdirSync(workspaceDir, { recursive: true });
		writeFileSync(join(workspaceDir, 'facts.json'), JSON.stringify(authored));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, factsPath: join(workspaceDir, 'facts.json'), ...captured };
};

const mixedFacts = {
	request: 'add a widget',
	areas: [
		{
			area: 'cli',
			affectedPackages: [],
			filesToModify: [
				{ path: 'src/real.ts', role: 'the file that exists' },
				{ path: 'src/missing.ts', role: 'the file that does not' },
			],
			patternsToMirror: [],
			integrationPoints: [],
			scripts: [
				{ key: 'check', command: 'tsc --noEmit' },
				{ key: 'nope', command: 'does not exist' },
			],
			namingConvention: 'camelCase',
		},
	],
};

test('planVerifyFactsCommand: a verified fact set prints the area count, both tallies, one ⚠ per miss, the facts path, and exits 0', async () => {
	const { context, factsPath, logged, errors, exitCodes } = setupVerifyFacts({ args: ['--name', 'demo'], authored: mixedFacts });

	await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1] ?? '').toMatch(/^\nplan verify-facts demo — 1 area\(s\), verified \d{4}-\d\d-\d\dT/);
	expect(logged[2]).toBe('  paths:   2 checked · 1 missing');
	expect(logged[3]).toBe('  scripts: 2 checked · 1 missing');
	expect(logged[4]).toBe('⚠ path not found: src/missing.ts');
	expect(logged[5]).toBe('⚠ script not found: nope');
	expect(logged[6]).toBe(`\nfacts: ${factsPath}`);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planVerifyFactsCommand: without --name it prints the usage text on stderr and exits 1 before reading any workspace', async () => {
	const { context, logged, errors, exitCodes } = setupVerifyFacts({ args: [] });

	await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planVerifyFactsCommand: no authored facts reports the workspace error on stderr and exits 1', async () => {
	const { context, errors, exitCodes } = setupVerifyFacts({ args: ['--name', 'demo'] });

	await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors[0] ?? '').toMatch(/no authored facts for plan demo/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planVerifyFactsCommand: a --notes path that does not exist fails before verification and exits 1', async () => {
	const { context, errors, exitCodes } = setupVerifyFacts({ args: ['--name', 'demo', '--notes', 'nowhere/notes.md'], authored: mixedFacts });

	await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors[0] ?? '').toMatch(/notes file not found: .*nowhere\/notes\.md/);
	expect(exitCodes).toStrictEqual([1]);
});
