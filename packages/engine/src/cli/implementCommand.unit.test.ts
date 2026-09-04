import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** The plan folder every folder-routing case points `--plan` at. */
const planFolder = 'plans/demo';

/**
 * An overview whose Phases table names one file per phase, beside the phase
 * files themselves. Zero phases leaves the table with nothing but its header,
 * which is how the coordinator's refusal to start becomes observable.
 */
const writePhasedPlanFolder = ({ cwd, phases }: { cwd: string; phases: number }) => {
	const rows = Array.from({ length: phases }, (_, index) => `| ${index + 1} | \`phase${index + 1}.md\` | scope |`);

	writeFileSync(join(cwd, planFolder, 'overview.md'), `# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n${rows.join('\n')}\n`);

	for (let phase = 1; phase <= phases; phase += 1) {
		writeFileSync(join(cwd, planFolder, `phase${phase}.md`), `# Feature — Phase ${phase}\n`);
	}
};

// A real consumer repo whose --plan names a file that does not exist: the
// pipeline fails fast at the plan read, before any harness is spawned, so the
// command's whole render-and-exit path is observable without an agent.
// `folderFiles` seeds plans/demo for the folder cases and `phases` seeds it with
// a real overview; `locked` plants a live run lock, which is how a folder
// holding a REAL plan — one plan.md or a whole table of phases — fails fast too.
const setupImplement = ({
	args,
	folderFiles,
	phases,
	locked,
	scripts,
	config,
}: {
	args: string[];
	folderFiles?: string[];
	phases?: number;
	locked?: boolean;
	/** Gate commands merged over the defaults, so the banner's opt-in gate lines have something to name. */
	scripts?: Record<string, string | false>;
	/** Extra top-level config fields the banner reads. */
	config?: Record<string, unknown>;
}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ scripts, config });

	if (folderFiles || phases !== undefined) {
		mkdirSync(join(cwd, planFolder), { recursive: true });
	}

	for (const file of folderFiles ?? []) {
		writeFileSync(join(cwd, planFolder, file), '# Plan: add feature\n');
	}

	if (phases !== undefined) {
		writePhasedPlanFolder({ cwd, phases });
	}

	if (locked) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

test('implementCommand: without --plan it prints the usage text on stderr and exits 1 before loading any config', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--skip-refactor'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors.length).toBe(1);
	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a plan path that does not exist prints the run header, reports the failure on stderr and exits 1', async () => {
	const { context, cwd, logged, errors, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[0]).toBe('lightsout: starting run');
	expect(logged[1]).toBe('  plan: ghost.md');
	// the run header names the target repo, got: ${JSON.stringify(logged)}
	expect(logged.some((line) => line === `  cwd: ${cwd}`)).toBeTruthy();
	// the resolved harness rides the header
	expect(logged.some((line) => /^ {2}harness: claude-code · model: harness default/.test(line))).toBeTruthy();
	// the pipeline's failure reaches stderr, got: ${JSON.stringify(errors)}
	expect(errors.some((line) => /plan file not found: .*ghost\.md/.test(line))).toBeTruthy();
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: --overview and --packages are echoed on the plan line, the package list trimmed and emptied entries dropped', async () => {
	const { context, logged, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md', '--overview', 'overview.md', '--packages', ' api , ,web '] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe('  plan: ghost.md\n  overview: overview.md\n  packages flag: api, web');
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: an empty --packages list is no scope at all — the plan line carries no packages segment', async () => {
	const { context, logged, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md', '--packages', ' , '] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe('  plan: ghost.md\n  packages flag: ');
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a plan folder holding neither overview.md nor plan.md is refused before any config is loaded', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--plan', planFolder], folderFiles: ['notes.md'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors).toStrictEqual([`plan folder holds neither overview.md nor plan.md: ${planFolder}`]);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a plan folder holding only a plan.md runs it as a single plan', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--plan', planFolder], folderFiles: ['plan.md'], locked: true });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// the resolved plan.md is what the run header echoes — the folder is only the door
	expect(logged[1]).toBe(`  plan: ${join(planFolder, 'plan.md')}`);
	// the planted lock is what stops it, which means the single-plan path was taken
	expect(errors.some((line) => /another lightsout run is active in this repo/.test(line))).toBeTruthy();
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: --start-phase against a single plan is refused', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md', '--start-phase', '2'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors).toStrictEqual(['--start-phase applies to a plan folder holding an overview.md — a single plan has one phase']);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a --start-phase that is not a positive whole number is refused', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md', '--start-phase', 'two'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors).toStrictEqual(["--start-phase must be a positive integer, got 'two'"]);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: --overview against a plan folder that already runs every phase is refused', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--plan', planFolder, '--overview', 'other.md'], phases: 2 });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors).toStrictEqual(['--overview applies to a single-plan run — a plan folder with an overview.md already runs every phase']);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: --packages against a plan folder that runs every phase is refused', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--plan', planFolder, '--packages', 'api'], phases: 2 });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors).toStrictEqual(['--packages applies to a single-plan run — every phase of a plan folder reads its own scope']);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a plan folder holding an overview runs every phase, and the banner names the overview', async () => {
	const { context, logged, errors, exitCodes } = setupImplement({ args: ['--plan', planFolder], phases: 2, locked: true });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// no start-phase segment: the sequence starts where it always does
	expect(logged[1]).toBe(`  overview: ${join(planFolder, 'overview.md')}`);
	// the planted lock stops the first phase's own run, which means the phase loop was entered
	expect(errors.join('\n')).toContain('another lightsout run is active in this repo');
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: --start-phase is echoed on the banner of a phased run', async () => {
	const { context, logged, exitCodes } = setupImplement({ args: ['--plan', planFolder, '--start-phase', '2'], phases: 2, locked: true });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[1]).toBe(`  overview: ${join(planFolder, 'overview.md')}\n  start phase: 2`);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: an overview the coordinator refuses reports the reason as one line, not a stack', async () => {
	const { context, errors, exitCodes } = setupImplement({ args: ['--plan', planFolder], phases: 0 });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors.join('\n')).toContain(`overview has no Phases table rows: ${join(planFolder, 'overview.md')}`);
	expect(errors.join('\n')).not.toMatch(/ {4}at /);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: the run banner names every opt-in the repo config declares, so a reader sees the run’s real gate set', async () => {
	const { context, logged, exitCodes } = setupImplement({
		args: ['--plan', 'ghost.md'],
		scripts: { 'test-coverage': 'pnpm test:coverage', generate: 'pnpm codegen', build: 'pnpm build', format: 'pnpm format' },
		config: {
			permissions: 'full-access',
			timeouts: { 'agent-minutes': 90, 'supervisor-minutes': 20 },
			'agent-commands': ['pnpm prisma migrate'],
			generated: ['src/generated/'],
			'package-gates': { check: 'pnpm --filter {package} check', test: 'pnpm --filter {package} test', 'test-coverage': 'pnpm --filter {package} cov' },
		},
	});

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toEqual(
		expect.arrayContaining([
			'  harness: claude-code · model: harness default · effort: harness default · permissions: full-access',
			'  timeouts: agent 90m · supervisor 20m · gate 15m',
			'  gates (root): check=[true] test=[true] coverage=[pnpm test:coverage]',
			'  generate (before every gate set): [pnpm codegen]',
			'  agent commands (granted, prefix match): [pnpm prisma migrate]',
			'  generated (never attributed): src/generated/',
			'  gates (root, opt-in): build=[pnpm build]',
			'  format: [pnpm format]',
			'  gates (per package): check=[pnpm --filter {package} check] test=[pnpm --filter {package} test] coverage=[pnpm --filter {package} cov]',
		]),
	);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a repo that declared no opt-ins gets no lines for them — the banner never invents a gate', async () => {
	const { context, logged, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// an unset coverage gate and an unset standards list read as two different
	// silences, and the banner says which is which
	expect(logged).toContain('  gates (root): check=[true] test=[true] coverage=[off (explicit)]');
	expect(logged).toContain('  standards packs: lightsout-defaults (none configured — set to false to disable, or list pack roots)');
	expect(logged).toContain('  timeouts: agent 60m · supervisor 15m · gate 15m');
	expect(logged.some((line) => /^ {2}(generate|agent commands|generated|format|gates \((root, opt-in|per package)\))/.test(line))).toBe(false);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: the banner names the harness this command asked for, and drops a global model that belonged to the harness it replaced', async () => {
	const { context, logged, exitCodes } = setupImplement({
		args: ['--plan', 'ghost.md'],
		config: { harness: 'codex', model: 'gpt-5-codex', effort: 'high', commands: { implement: { harness: 'claude-code' } } },
	});

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// a model name means something only to its own harness, so replacing the
	// harness for this command drops the global model — while effort, which
	// means the same thing everywhere, still falls through
	expect(logged).toContain('  harness: claude-code · model: harness default · effort: high · permissions: write');
	expect(logged.some((line) => line.includes('gpt-5-codex'))).toBe(false);
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a command entry that only names a model keeps the global harness and rides its own model', async () => {
	const { context, logged } = setupImplement({
		args: ['--plan', 'ghost.md'],
		config: { model: 'global-model', commands: { implement: { model: 'implement-model' } } },
	});

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toContain('  harness: claude-code · model: implement-model · effort: harness default · permissions: write');
});

test('implementCommand: standards packs turned off explicitly say so, rather than reading as the unconfigured default', async () => {
	const { context, logged } = setupImplement({ args: ['--plan', 'ghost.md'], config: { 'standards-packs': false } });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toContain('  standards packs: none (explicit)');
});

test('implementCommand: configured pack roots ride the banner verbatim, in the order the config declared them', async () => {
	const { context, logged } = setupImplement({
		args: ['--plan', 'ghost.md'],
		config: { 'standards-packs': ['standards/house', '/opt/acme-standards'] },
	});

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// the banner is what a reader checks the run against, so the roots are
	// echoed exactly as configured — neither reordered nor resolved to absolute
	expect(logged).toContain('  standards packs: standards/house, /opt/acme-standards');
});

test('implementCommand: an empty pack list is still a configured list — the banner never falls back to the defaults wording', async () => {
	const { context, logged } = setupImplement({ args: ['--plan', 'ghost.md'], config: { 'standards-packs': [] } });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toContain('  standards packs: ');
	expect(logged.some((line) => line.includes('lightsout-defaults'))).toBe(false);
});

test('implementCommand: --ship never ships a run that failed — the flag asks for a merge of verified work, and nothing was verified', async () => {
	// A fake `gh` on PATH answering nothing: its log is how "the forge was never touched" becomes observable.
	const { readForgeLog } = stubForgeOnPath({ responses: {} });
	const { context, errors, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md', '--ship'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(readForgeLog()).toStrictEqual([]);
	expect(errors.some((line) => /plan file not found: .*ghost\.md/.test(line))).toBeTruthy();
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a finished run ends on its report card — the plan it ran, its timings, and where the evidence landed', async () => {
	const { context, logged, exitCodes } = setupImplement({ args: ['--plan', 'ghost.md'] });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// the run id is cut to its first 8 characters — long enough to name a run, short enough to read
	expect(logged.some((line) => /^run {7}[0-9a-f]{8} · FAILED$/.test(line))).toBeTruthy();
	expect(logged).toContain('plan      ghost.md');
	// under a minute, a duration reads as whole seconds
	expect(logged.some((line) => /^wall {6}\d+s$/.test(line))).toBeTruthy();
	expect(logged).toContain('gates     0s');
	// no gate ever ran, and the tally says zero rather than going silent
	expect(logged).toContain('gates     0 commands');
	expect(logged.some((line) => /^evidence {2}\.lightsout\/runs\/[0-9a-f-]{36}\/$/.test(line))).toBeTruthy();
	expect(exitCodes).toStrictEqual([1]);
});
