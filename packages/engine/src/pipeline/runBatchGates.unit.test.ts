import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { runBatchGates } from '#src/pipeline/index.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { setupMonorepo } from '#tests/helpers/setupMonorepo.ts';

/** A monorepo with the given files dirtied — the git diff is what the scope is read from. */
const setupTouched = async ({ files, git = true }: { files: string[]; git?: boolean }) => {
	const dir = setupMonorepo();

	for (const file of files) {
		writeFileSync(join(dir, file), 'export const written = 1;\n');
	}

	if (!git) {
		rmSync(join(dir, '.git'), { recursive: true, force: true });
	}

	return { dir, config: await readConfig({ cwd: dir }), gates: () => readGateLog({ dir }) };
};

/**
 * A monorepo whose packages sit under a configured directory rather than the
 * default one, with a dirtied file inside its single package.
 */
const setupConfiguredPackagesDir = async ({ packagesDir, packageCheck }: { packagesDir: string; packageCheck?: string }) => {
	const dir = setupConsumerRepo({
		scripts: { check: `${gateLogCommand({ kind: 'check' })} root`, test: `${gateLogCommand({ kind: 'test' })} root` },
		config: {
			'packages-dir': packagesDir,
			'package-gates': {
				check: packageCheck ?? `${gateLogCommand({ kind: 'check' })} {package}`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
			},
		},
	});

	mkdirSync(join(dir, packagesDir, 'api', 'src'), { recursive: true });
	writeFileSync(join(dir, packagesDir, 'api', 'package.json'), JSON.stringify({ name: '@acme/api' }));
	writeFileSync(join(dir, packagesDir, 'api', 'src/added.js'), 'export const written = 1;\n');

	return { dir, config: await readConfig({ cwd: dir }), gates: () => readGateLog({ dir }) };
};

describe('runBatchGates', () => {
	test('runs only the packages the tree actually touched, sparing every other suite', async () => {
		const { dir, config, gates } = await setupTouched({ files: ['packages/api/src/added.js'] });

		const error = await runBatchGates({ cwd: dir, config, coverage: true, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		expect(error).toBe(undefined);
		expect(gates().includes('@acme/api check')).toBeTruthy();
		// the untouched package's suite is never spent: ${gates().join(', ')}
		expect(gates().some((line) => line.startsWith('@acme/web '))).toBeFalsy();
		// nothing outside the packages dir changed, so the root group stays out
		expect(gates().some((line) => line.startsWith('root '))).toBeFalsy();
	});

	test('a file outside the packages dir brings the root group back in', async () => {
		const { dir, config, gates } = await setupTouched({ files: ['packages/api/src/added.js', 'tooling.js'] });

		await runBatchGates({ cwd: dir, config, coverage: true, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		// a root-level change is verified by the whole-repo scripts, not by any package
		expect(gates().includes('root check')).toBeTruthy();
		expect(gates().includes('@acme/api check')).toBeTruthy();
	});

	test('the coverage flag on runs the coverage gate', async () => {
		const { dir, config, gates } = await setupTouched({ files: ['packages/api/src/added.js'] });

		await runBatchGates({ cwd: dir, config, coverage: true, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		// a refactor batch must not drop coverage
		expect(gates().includes('@acme/api coverage')).toBeTruthy();
	});

	test('the coverage flag off runs the plain suite instead of the coverage gate', async () => {
		const { dir, config, gates } = await setupTouched({ files: ['packages/api/src/added.js'] });

		await runBatchGates({ cwd: dir, config, coverage: false, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		// a coverage batch's own gate is red by definition mid-run — it runs the
		// plain suite instead, or every batch would fail on the thing it is fixing
		expect(gates().includes('@acme/api coverage')).toBeFalsy();
		expect(gates().includes('@acme/api test')).toBeTruthy();
	});

	test('the run id and step ride into the command log, so a batch gate leaves evidence', async () => {
		const { dir, config } = await setupTouched({ files: ['packages/api/src/added.js'] });

		await runBatchGates({ cwd: dir, config, coverage: false, runId: 'run-evidence', step: 'batch-07:api', onProgress: () => undefined });

		const log = readFileSync(join(dir, '.lightsout', 'runs', 'run-evidence', 'commands.jsonl'), 'utf8');

		// a gate that leaves no evidence is indistinguishable from one that never ran
		expect(log).toContain('"step":"batch-07:api"');
		expect(log).toContain('"group":"api"');
	});

	test('several files in one package still spend that package suite once', async () => {
		const { dir, config, gates } = await setupTouched({ files: ['packages/api/src/added.js', 'packages/api/src/second.js'] });

		await runBatchGates({ cwd: dir, config, coverage: false, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		// two files, one package — a second run of the same suite is pure waste
		expect(gates().filter((line) => line === '@acme/api check')).toHaveLength(1);
	});

	test('the configured packages directory decides what counts as a package', async () => {
		const { dir, config, gates } = await setupConfiguredPackagesDir({ packagesDir: 'apps' });

		await runBatchGates({ cwd: dir, config, coverage: false, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		// under the default 'packages' reading, apps/api/... would look like a
		// root-level path and the package's own suite would never run
		expect(gates().includes('@acme/api check')).toBeTruthy();
		expect(gates().some((line) => line.startsWith('root '))).toBeFalsy();
	});

	test('without git truth the batch falls back to verifying the whole repo', async () => {
		const { dir, config, gates } = await setupTouched({ files: ['packages/api/src/added.js'], git: false });

		const error = await runBatchGates({ cwd: dir, config, coverage: false, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		expect(error).toBe(undefined);
		// no diff to scope by means no package is provably safe to skip — the
		// whole-repo scripts run rather than nothing at all
		expect(gates().includes('root check')).toBeTruthy();
		expect(gates().some((line) => line.startsWith('@acme/'))).toBeFalsy();
	});

	test('a red gate comes back as the failure text, not a swallowed error', async () => {
		const { dir, config } = await setupConfiguredPackagesDir({ packagesDir: 'packages', packageCheck: 'node -e "process.exit(3)" {package}' });

		const error = await runBatchGates({ cwd: dir, config, coverage: false, runId: 'run-1', step: 'batch-01:api', onProgress: () => undefined });

		// the caller's fix loop routes on this string — a lost failure would be
		// read as a green batch
		expect(error).toContain('exit 3');
		expect(error).toContain('[api]');
	});
});
