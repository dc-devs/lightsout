import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { planVerifyFactsCommand } from '@/cli/plan/planVerifyFactsCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

// verify-facts is deterministic — no agent — so the arrangement is a real
// consumer repo whose authored facts claim one real and one missing path plus
// one real and one missing script: the mixed case the command must warn about
// while still exiting 0.
const setupVerifyFacts = ({ t, args, authored }: { t: TestContext; args: string[]; authored?: Record<string, unknown> }) => {
	const captured = captureCommandOutput({ t });
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

test('planVerifyFactsCommand: a verified fact set prints the area count, both tallies, one ⚠ per miss, the facts path, and exits 0', async (t) => {
	const { context, factsPath, logged, errors, exitCodes } = setupVerifyFacts({ t, args: ['--name', 'demo'], authored: mixedFacts });

	await assert.rejects(planVerifyFactsCommand(context), /process\.exit/);

	assert.match(logged[1] ?? '', /^\nplan verify-facts demo — 1 area\(s\), verified \d{4}-\d\d-\d\dT/);
	assert.equal(logged[2], '  paths:   2 checked · 1 missing');
	assert.equal(logged[3], '  scripts: 2 checked · 1 missing');
	assert.equal(logged[4], '⚠ path not found: src/missing.ts');
	assert.equal(logged[5], '⚠ script not found: nope');
	assert.equal(logged[6], `\nfacts: ${factsPath}`);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('planVerifyFactsCommand: without --name it prints the usage text on stderr and exits 1 before reading any workspace', async (t) => {
	const { context, logged, errors, exitCodes } = setupVerifyFacts({ t, args: [] });

	await assert.rejects(planVerifyFactsCommand(context), /process\.exit/);

	assert.deepEqual(logged, []);
	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.deepEqual(exitCodes, [1]);
});

test('planVerifyFactsCommand: no authored facts reports the workspace error on stderr and exits 1', async (t) => {
	const { context, errors, exitCodes } = setupVerifyFacts({ t, args: ['--name', 'demo'] });

	await assert.rejects(planVerifyFactsCommand(context), /process\.exit/);

	assert.match(errors[0] ?? '', /no authored facts for plan demo/);
	assert.deepEqual(exitCodes, [1]);
});

test('planVerifyFactsCommand: a --notes path that does not exist fails before verification and exits 1', async (t) => {
	const { context, errors, exitCodes } = setupVerifyFacts({ t, args: ['--name', 'demo', '--notes', 'nowhere/notes.md'], authored: mixedFacts });

	await assert.rejects(planVerifyFactsCommand(context), /process\.exit/);

	assert.match(errors[0] ?? '', /notes file not found: .*nowhere\/notes\.md/);
	assert.deepEqual(exitCodes, [1]);
});
