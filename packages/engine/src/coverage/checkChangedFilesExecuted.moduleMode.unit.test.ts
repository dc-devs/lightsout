import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { checkChangedFilesExecuted } from '#src/coverage/checkChangedFilesExecuted.ts';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

const rootConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': 'npm run coverage' } };

const changedFiles = ['src/awaiting.ts', 'src/plain.ts'];

/**
 * A repo holding a module-scope-`await` file, a plain sibling, and an Istanbul
 * summary reporting both at zero executed statements — so whichever files the
 * gate holds to the bar are named in its message and whichever it exempts are
 * not. `settings` writes a real Jest config plus the package.json script the
 * root coverage command runs; omitted, the repo carries no Jest configuration
 * at all and the scope's module mode cannot be read. `collectCoverageFrom` is
 * deliberately never named — Jest reads its absence as "collect everything", so
 * neither file is skipped for the unrelated uncollected reason.
 */
const setupAwaitingRepo = ({ settings }: { settings?: Record<string, unknown> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-executed-mode-'));
	const sources: Record<string, string> = {
		'src/awaiting.ts': "import { main } from './cli';\n\nawait main();\n",
		'src/plain.ts': 'export const plain = () => 1;\n',
		// readExecutionSummary keys its map by relative(cwd, key), so the report
		// must carry the absolute paths Istanbul actually writes.
		'coverage/coverage-summary.json': JSON.stringify({
			total: { statements: { pct: 0, covered: 0, total: 6 } },
			...Object.fromEntries(changedFiles.map((file) => [join(cwd, file), { statements: { pct: 0, covered: 0, total: 3 } }])),
		}),
	};

	if (settings) {
		sources['package.json'] = JSON.stringify({ name: 'consumer', scripts: { coverage: 'jest -c jest.config.cjs --coverage' } });
		sources['jest.config.cjs'] = `module.exports = ${JSON.stringify(settings)};\n`;
	}

	for (const [name, content] of Object.entries(sources)) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), content);
	}

	return cwd;
};

test('checkChangedFilesExecuted: a module-scope-await file is exempt when the scope’s Jest loads it as CommonJS', async () => {
	const cwd = setupAwaitingRepo({ settings: {} });

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles, compiler: ts });

	// src/awaiting.ts is a syntax error to this runner, so no test could ever
	// execute a statement of it — only the plain sibling is held to the bar
	expect(error).toBe(
		"changed-file-execution: 1 changed file(s) never executed under the tests: src/plain.ts — cover each through its public subject's tests; a file no test can reach through a public surface is a wiring defect to fix in source.",
	);
});

test('checkChangedFilesExecuted: a module-scope-await file is held to the bar when the scope’s Jest treats its extension as ESM', async () => {
	const cwd = setupAwaitingRepo({ settings: { extensionsToTreatAsEsm: ['.ts'] } });

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles, compiler: ts });

	// the same file loads normally under an ESM Jest, so it earns no exemption
	expect(error).toBe(
		"changed-file-execution: 2 changed file(s) never executed under the tests: src/awaiting.ts, src/plain.ts — cover each through its public subject's tests; a file no test can reach through a public surface is a wiring defect to fix in source.",
	);
});

test('checkChangedFilesExecuted: a scope whose Jest configuration cannot be read keeps the module-scope-await exemption', async () => {
	const cwd = setupAwaitingRepo();

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles, compiler: ts });

	// an unread configuration answers CommonJS, which is the shipped behaviour
	// and the safe direction: a wrong ESM verdict would fail the run on a file
	// no test could cover
	expect(error).toBe(
		"changed-file-execution: 1 changed file(s) never executed under the tests: src/plain.ts — cover each through its public subject's tests; a file no test can reach through a public surface is a wiring defect to fix in source.",
	);
});
