import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LightsoutConfig } from '@lightsout/contracts';
import { extractRunScriptName } from './extractRunScriptName';
import { loadConfig } from './loadConfig';
import { resolvePackageManifest } from './resolvePackageManifest';
import { runCommand } from './runCommand';

const probeTimeoutMs = 15_000;
const driverBinaries: Record<string, string> = { 'claude-code': 'claude', codex: 'codex' };
const gitignoreEntries = ['.lightsout/runs/', '.lightsout/friction.jsonl', '.lightsout/lock.json'];

interface DoctorCheck {
	id: string;
	/** `note` = worth seeing, not worth fixing — a legitimate state that would also be the symptom of a mistake (e.g. intentional gate skips vs a typo'd script name). */
	status: 'pass' | 'note' | 'warn' | 'fail';
	detail: string;
	/** The exact change that clears a warn/fail — the doctor never applies it. */
	fix?: string;
}

const severityRank: Record<DoctorCheck['status'], number> = { pass: 0, note: 1, warn: 2, fail: 3 };

/** Jest config files for one package dir: root-level jest.config.* plus anything jest-named under test/ (bounded — never node_modules). */
const findJestConfigs = async ({ packageDir }: { packageDir: string }) => {
	const rootEntries = await readdir(packageDir).catch(() => [] as string[]);
	const found = rootEntries.filter((name) => /^jest(\..+)?\.config\.(js|cjs|mjs|ts)$/.test(name)).map((name) => join(packageDir, name));
	const testEntries = await readdir(join(packageDir, 'test'), { recursive: true }).catch(() => [] as string[]);

	return [
		...found,
		...testEntries
			.filter((name) => typeof name === 'string' && /(^|\/)jest[^/]*\.config\.(js|cjs|mjs|ts)$/.test(name))
			.map((name) => join(packageDir, 'test', name)),
	];
};

interface Params {
	cwd: string;
	/** Test seam for the harness binary probe — defaults to running `<binary> --version`. */
	probeHarness?: (params: { binary: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/**
 * Read-only audit of a consumer repo against every assumption the engine and
 * the bundled standards make: config validity, harness binary, gitignore run
 * state, scoped-gate script coverage, Jest mock-cleanup config, generated
 * paths, script binaries. Each warn/fail carries the exact fix; the doctor
 * NEVER mutates — repo-wide changes (e.g. `clearMocks: true`) are a human's
 * decision to apply and verify.
 */
export const runDoctor = async ({ cwd, probeHarness }: Params) => {
	const checks: DoctorCheck[] = [];

	let config: LightsoutConfig;

	try {
		config = await loadConfig({ cwd });
	} catch (error) {
		return [
			{
				id: 'config',
				status: 'fail',
				detail: error instanceof Error ? error.message : String(error),
				fix: 'create or repair lightsout.config.json — every other check depends on it',
			},
		] satisfies DoctorCheck[];
	}

	const packagesDir = config.packagesDir ?? 'packages';

	checks.push({
		id: 'config',
		status: 'pass',
		detail: `lightsout.config.json valid · driver ${config.driver ?? 'claude-code'}${config.packageScripts ? ` · monorepo (${packagesDir}/)` : ''}`,
	});

	const binary = driverBinaries[config.driver ?? 'claude-code'] ?? (config.driver as string);
	const probe = probeHarness ?? (({ binary: name }) => runCommand({ command: `${name} --version`, cwd, timeoutMs: probeTimeoutMs }));

	try {
		const probed = await probe({ binary });

		checks.push(
			probed.exitCode === 0
				? { id: 'harness', status: 'pass', detail: `${binary} ${probed.stdout.trim().split('\n')[0]} (login not probed — the first run verifies it)` }
				: {
						id: 'harness',
						status: 'fail',
						detail: `\`${binary} --version\` exited ${probed.exitCode}: ${`${probed.stdout}\n${probed.stderr}`.trim().slice(0, 200)}`,
						fix: `reinstall or repair the ${binary} CLI — the engine shells your own logged-in binary and cannot run without it`,
					},
		);
	} catch (error) {
		checks.push({
			id: 'harness',
			status: 'fail',
			detail: `${binary} not runnable: ${error instanceof Error ? error.message : String(error)}`,
			fix: `install the ${binary} CLI and log in`,
		});
	}

	// Ask git what it actually ignores instead of parsing .gitignore
	// ourselves — `.lightsout` (no slash), `.lightsout/`, and a dozen other
	// spellings are all valid; line-matching false-warned on a real consumer.
	const notIgnored: string[] = [];
	let gitUsable = true;

	for (const entry of gitignoreEntries) {
		const probePath = entry.endsWith('/') ? `${entry}probe` : entry;
		const result = await runCommand({ command: `git check-ignore -q -- '${probePath}'`, cwd, timeoutMs: probeTimeoutMs }).catch(() => ({
			exitCode: 128,
		}));

		if (result.exitCode === 1) {
			notIgnored.push(entry);
		} else if (result.exitCode !== 0) {
			gitUsable = false;
		}
	}

	checks.push(
		!gitUsable
			? { id: 'gitignore', status: 'warn', detail: 'not a git repository — .gitignore not evaluated' }
			: notIgnored.length === 0
				? { id: 'gitignore', status: 'pass', detail: 'run state is ignored (verified via git check-ignore)' }
				: {
						id: 'gitignore',
						status: 'warn',
						detail: `run state not ignored: ${notIgnored.join(', ')}`,
						fix: `add to .gitignore:\n${notIgnored.join('\n')}`,
					},
	);

	// Which scoped gates would skip, surfaced before any run: a package with
	// no matching script is legitimate (infra, docs) — the doctor names it so
	// intent and accident are distinguishable.
	const packageDirs: Array<{ label: string; dir: string }> = [{ label: 'root', dir: cwd }];

	if (config.packageScripts) {
		const entries = await readdir(join(cwd, packagesDir), { withFileTypes: true }).catch(() => []);
		const templates = Object.entries(config.packageScripts).filter((pair): pair is [string, string] => typeof pair[1] === 'string');
		const skips: string[] = [];

		for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.'))) {
			const manifest = await resolvePackageManifest({ cwd, packagesDir, packageDir: entry.name }).catch(() => undefined);

			if (!manifest) {
				continue;
			}

			packageDirs.push({ label: entry.name, dir: join(cwd, packagesDir, entry.name) });

			const absent = templates
				.map(([kind, template]) => ({ kind, script: extractRunScriptName({ command: template }) }))
				.filter(({ script }) => script !== undefined && !Object.hasOwn(manifest.scripts, script));

			if (absent.length > 0) {
				skips.push(`${entry.name} (${absent.map(({ script }) => script).join(', ')})`);
			}
		}

		checks.push(
			skips.length === 0
				? { id: 'scoped-gates', status: 'pass', detail: 'every package defines every scoped gate script' }
				: {
						id: 'scoped-gates',
						status: 'note',
						detail: `gates will skip for: ${skips.join('; ')} — intentional if these packages have nothing to check; a typo'd script name looks identical`,
					},
		);
	}

	// The test standards' Mock Cleanup section assumes clearMocks/restoreMocks
	// in Jest config; agents are forbidden from adding them mid-run (repo-wide
	// behavior change), so the doctor is where the gap gets surfaced.
	const jestFindings: string[] = [];
	let jestConfigCount = 0;

	for (const { label, dir } of packageDirs) {
		for (const configPath of await findJestConfigs({ packageDir: dir })) {
			jestConfigCount += 1;

			const text = await readFile(configPath, 'utf8').catch(() => '');
			const absent = ['clearMocks', 'restoreMocks'].filter((flag) => !new RegExp(`${flag}\\s*:\\s*true`).test(text));

			if (absent.length > 0) {
				jestFindings.push(`${label}: ${configPath.slice(cwd.length + 1)} lacks ${absent.join(', ')}`);
			}
		}
	}

	if (jestConfigCount > 0) {
		checks.push(
			jestFindings.length === 0
				? { id: 'jest-mocks', status: 'pass', detail: 'all Jest configs set clearMocks + restoreMocks' }
				: {
						id: 'jest-mocks',
						status: 'warn',
						detail: jestFindings.join('; '),
						fix: 'add clearMocks: true, restoreMocks: true — then run that package’s FULL test suite: tests relying on import-time or beforeAll mock calls will break and need rework (see test standards, Mock Cleanup)',
					},
		);
	}

	if (config.generated) {
		const absent: string[] = [];

		for (const prefix of config.generated) {
			await stat(join(cwd, prefix)).catch(() => absent.push(prefix));
		}

		checks.push(
			absent.length === 0
				? { id: 'generated', status: 'pass', detail: `${config.generated.length} generated path(s) exist` }
				: {
						id: 'generated',
						status: 'warn',
						detail: `not found: ${absent.join(', ')}`,
						fix: 'run the generator once, or remove stale entries from `generated`',
					},
		);
	}

	const scriptCommands = [...Object.values(config.scripts), ...Object.values(config.packageScripts ?? {})].filter(
		(value): value is string => typeof value === 'string',
	);
	const binaries = [...new Set(scriptCommands.map((command) => command.trim().split(/\s+/)[0]).filter(Boolean))];
	const missingBinaries: string[] = [];

	for (const name of binaries) {
		const result = await runCommand({ command: `command -v ${name}`, cwd, timeoutMs: probeTimeoutMs }).catch(() => ({ exitCode: -1 }));

		if (result.exitCode !== 0) {
			missingBinaries.push(name as string);
		}
	}

	checks.push(
		missingBinaries.length === 0
			? { id: 'script-binaries', status: 'pass', detail: `gate commands resolve (${binaries.join(', ')})` }
			: {
					id: 'script-binaries',
					status: 'fail',
					detail: `not on PATH: ${missingBinaries.join(', ')}`,
					fix: 'install the missing tool(s) — every gate depends on them',
				},
	);

	// Positives first, actionable items last (nearest the prompt) — stable
	// within each severity, so related checks keep their relative order.
	return checks.sort((a, b) => severityRank[a.status] - severityRank[b.status]);
};
