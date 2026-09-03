import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { checkChangedFilesExecuted } from '#src/coverage/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { selectTestTargets } from '#src/pipeline/steps/selectTestTargets.ts';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': 'npm run coverage' } };

const files = ['src/awaiting.ts', 'src/plain.ts'];

/**
 * One repo both halves read: a real Jest config, a module-scope-await file, a
 * plain sibling, and an Istanbul summary reporting both at zero executed
 * statements — so the gate always has a report to open and always produces a
 * message. `collectCoverageFrom` is deliberately absent, which Jest reads as
 * "collect everything"; naming it would skip both files for the other reason.
 */
const setupRepo = ({ settings }: { settings: Record<string, unknown> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-agreement-'));
	const sources: Record<string, string> = {
		'package.json': JSON.stringify({ name: 'consumer', scripts: { coverage: 'jest -c jest.config.cjs --coverage' } }),
		'jest.config.cjs': `module.exports = ${JSON.stringify(settings)};\n`,
		'src/awaiting.ts': "import { main } from './cli';\n\nawait main();\n",
		'src/plain.ts': 'export const plain = () => 1;\n',
		// readExecutionSummary keys its map by relative(cwd, key), so the report
		// must carry the absolute paths Istanbul actually writes.
		'coverage/coverage-summary.json': JSON.stringify({
			total: { statements: { pct: 0, covered: 0, total: 6 } },
			...Object.fromEntries(files.map((file) => [join(cwd, file), { statements: { pct: 0, covered: 0, total: 3 } }])),
		}),
	};

	for (const [name, content] of Object.entries(sources)) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), content);
	}

	return cwd;
};

/** The gate reports a message rather than a set, so its exemptions are the candidates it never named. */
const splitBothWays = async ({ settings }: { settings: Record<string, unknown> }) => {
	const cwd = setupRepo({ settings });
	const message = await checkChangedFilesExecuted({ cwd, config, changedFiles: files, compiler: ts });
	// selectTestTargets reads only run.cwd and run.config; the cast hands the
	// step exactly the slice of a run it touches.
	const run = { cwd, config } as unknown as PipelineRun;
	const { targets, uncoverable } = await selectTestTargets({ run, candidates: files, compiler: ts, packagesDir: 'packages' });

	return { message, exempted: files.filter((file) => message === undefined || !message.includes(file)), targets, uncoverable };
};

test('selectUnloadableFiles: the execution gate and the write-tests split agree about a module-scope-await file in CommonJS mode', async () => {
	const { message, exempted, targets, uncoverable } = await splitBothWays({ settings: {} });

	expect(message).toContain('never executed under the tests: src/plain.ts');
	expect(uncoverable).toStrictEqual(['src/awaiting.ts']);
	expect(targets).toStrictEqual(['src/plain.ts']);
	// the file the gate exempts is exactly the file the writer selection skips
	expect(exempted).toStrictEqual(uncoverable);
});

test('selectUnloadableFiles: the execution gate and the write-tests split agree about a module-scope-await file in ESM mode', async () => {
	const { message, exempted, targets, uncoverable } = await splitBothWays({ settings: { extensionsToTreatAsEsm: ['.ts'] } });

	expect(message).toContain('never executed under the tests: src/awaiting.ts, src/plain.ts');
	expect(uncoverable).toStrictEqual([]);
	expect(targets).toStrictEqual(files);
	expect(exempted).toStrictEqual(uncoverable);
});
