import { expect, test } from '@jest/globals';
import { buildFeatureExecutorInvocation } from '#src/agents/index.ts';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const overviewContent = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const allowedCommands = ['pnpm --filter api run prisma:migrate:dev:name'];

test('buildFeatureExecutorInvocation: the system prompt carries role, overview, plan, standards, and granted commands in that order', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Feature Executor')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (high-level context)`)).toBeTruthy();
	expect(systemPrompt.includes(`# Plan\n\n${planContent}`)).toBeTruthy();
	expect(systemPrompt.includes(`# Standards\n\nThese rules are binding for every line you write:\n\n${standards}`)).toBeTruthy();
	expect(systemPrompt.includes(`# Granted commands\n\nYou may run these shell commands`)).toBeTruthy();
	// the grant lists the exact prefix
	expect(systemPrompt.includes(`- \`${allowedCommands[0]}\``)).toBeTruthy();
	// section order is deterministic
	expect(
		systemPrompt.indexOf('# Overview (high-level context)') < systemPrompt.indexOf('# Plan\n\n') &&
			systemPrompt.indexOf('# Plan\n\n') < systemPrompt.indexOf('# Standards\n\n') &&
			systemPrompt.indexOf('# Standards\n\n') < systemPrompt.indexOf('# Granted commands\n\nYou may run these shell commands'),
	).toBeTruthy();
});

test('buildFeatureExecutorInvocation: optional sections are omitted when their input is absent or empty', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, allowedCommands: [] });

	// no overview section for an unphased plan
	expect(systemPrompt.includes('# Overview (high-level context)')).toBeFalsy();
	// no standards section when standards are absent
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
	// an empty grant list emits no grant section
	expect(systemPrompt.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
});

test('buildFeatureExecutorInvocation: the system prompt is byte-identical across a fix retry', () => {
	const first = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });
	const retry = buildFeatureExecutorInvocation({
		planContent,
		overviewContent,
		standards,
		allowedCommands,
		changedFiles: ['src/widget.ts'],
		errorContext: 'check failed',
	});

	// the fix-retry variables cannot break the cached prefix
	expect(first.systemPrompt).toBe(retry.systemPrompt);
});

test('buildFeatureExecutorInvocation: a first spawn user prompt is the report reminder alone — everything else is in the system prompt', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	expect(prompt).toBe('Remember: your entire final message must be exactly one JSON report object — nothing else.');
});

test('buildFeatureExecutorInvocation: the fix-retry sections ride the user prompt, each only when its input is present', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	expect(prompt.startsWith('# Previously changed files')).toBeTruthy();
	expect(prompt.includes('- src/widget.ts')).toBeTruthy();
	expect(prompt.includes('# Verification failure')).toBeTruthy();
	// the gate output lands verbatim
	expect(prompt.includes('GATE-SENTINEL')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON report object')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: an absent grant list emits no grant section', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, standards });

	// a run that grants nothing carries no grant section
	expect(systemPrompt.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
});

test('buildFeatureExecutorInvocation: every granted command gets its own backticked bullet', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({
		planContent,
		allowedCommands: ['pnpm --filter api run prisma:migrate:dev:name', 'pnpm run codegen'],
	});

	// the grants list one prefix per line, in the order given
	expect(systemPrompt.includes('- `pnpm --filter api run prisma:migrate:dev:name`\n- `pnpm run codegen`')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: the system prompt separates its sections with a horizontal rule', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	// the overview is fenced off from the role prompt
	expect(systemPrompt.includes('\n\n---\n\n# Overview (high-level context)')).toBeTruthy();
	// the plan is fenced off from the overview
	expect(systemPrompt.includes(`\n\n---\n\n# Plan\n\n${planContent}`)).toBeTruthy();
	// the standards are fenced off from the plan
	expect(systemPrompt.includes('\n\n---\n\n# Standards\n\n')).toBeTruthy();
	// the grants are fenced off from the standards
	expect(systemPrompt.includes('\n\n---\n\n# Granted commands\n\n')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: an empty changed-file list emits no previously-changed section', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, changedFiles: [] });

	expect(prompt).toBe('Remember: your entire final message must be exactly one JSON report object — nothing else.');
});

test('buildFeatureExecutorInvocation: every previously changed file gets its own bullet', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, changedFiles: ['src/widget.ts', 'src/widget.unit.test.ts'] });

	// the cumulative file list is one bullet per file, in order
	expect(prompt.includes('- src/widget.ts\n- src/widget.unit.test.ts')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: a fix re-invocation with no prior file list leads with the verification failure', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, errorContext: 'GATE-SENTINEL' });

	// the gate output leads when nothing changed earlier in the run
	expect(prompt.startsWith('# Verification failure')).toBeTruthy();
	// no empty previously-changed section is emitted
	expect(prompt.includes('# Previously changed files')).toBeFalsy();
	// the gate output lands verbatim
	expect(prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: none of the run-stable content leaks back into the user prompt', () => {
	const { prompt } = buildFeatureExecutorInvocation({
		planContent,
		overviewContent,
		standards,
		allowedCommands,
		changedFiles: ['src/widget.ts'],
		errorContext: 'check failed',
	});

	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
	expect(prompt.includes('# Granted commands')).toBeFalsy();
});

test('buildFeatureExecutorInvocation: the locked ledger test files ride the user prompt, and say what they are for', () => {
	const clean = buildFeatureExecutorInvocation({ planContent });
	const locked = buildFeatureExecutorInvocation({ planContent, ledgerTests: ['src/widget.unit.test.ts', 'src/flag.unit.test.ts'] });

	// a plan with no ledger gets no section at all
	expect(clean.prompt.includes('# Ledger tests (read-only)')).toBeFalsy();
	expect(buildFeatureExecutorInvocation({ planContent, ledgerTests: [] }).prompt.includes('# Ledger tests (read-only)')).toBeFalsy();
	// each locked path gets its own bullet
	expect(locked.prompt.includes('# Ledger tests (read-only)\n\n- src/widget.unit.test.ts\n- src/flag.unit.test.ts')).toBeTruthy();
	// the executor is told these are the bar, not an obstacle to edit around
	expect(locked.prompt.includes('must pass in the gate run before the work is done')).toBeTruthy();
	// the report-contract reminder still closes the prompt
	expect(locked.prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: the ledger paths never enter the cached system prompt', () => {
	const first = buildFeatureExecutorInvocation({ planContent, overviewContent, standards });
	const locked = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, ledgerTests: ['src/widget.unit.test.ts'] });

	// the lock list is resolved per invocation, so it must not break the prefix
	// the harness caches across a run
	expect(first.systemPrompt).toBe(locked.systemPrompt);
});

test('buildFeatureExecutorInvocation: the user prompt orders changed files, the locked ledger tests, then the gate output', () => {
	const { prompt } = buildFeatureExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		ledgerTests: ['src/widget.unit.test.ts'],
		errorContext: 'GATE-SENTINEL',
	});

	// a fix re-invocation carrying all three reads them in one fixed order
	expect(
		prompt.indexOf('# Previously changed files') < prompt.indexOf('# Ledger tests (read-only)') &&
			prompt.indexOf('# Ledger tests (read-only)') < prompt.indexOf('# Verification failure'),
	).toBeTruthy();
	// the locked list stays out of the changed-file list it follows
	expect(
		prompt.includes('# Previously changed files\n\nFiles already created or modified earlier in this run:\n\n- src/widget.ts\n\n# Ledger tests'),
	).toBeTruthy();
});

test('buildFeatureExecutorInvocation: the role prompt bans editing the locked ledger tests and says what to do instead', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent });
	// the prompt wraps its lines; the sentences are what matter
	const prose = systemPrompt.replace(/\s+/g, ' ');

	// the rule names the same section heading the user prompt emits
	expect(prose).toContain('Files listed under a `# Ledger tests (read-only)` section in your task are the tests that define done; never edit them.');
	// editing is pointless, so the executor is told the engine reverts it
	expect(prose).toContain('The engine keeps a copy and reverts any change before verification');
	// the one legitimate escape is a report, not an edit
	expect(prose).toContain('report `failed` naming the test and why, rather than changing it');
});

test('buildFeatureExecutorInvocation: the command ban names what is banned and leaves file access open — a harness whose only file access is a shell must not read it as "touch nothing"', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent });
	// the prompt wraps its lines; the sentences are what matter
	const prose = systemPrompt.replace(/\s+/g, ' ');

	// verification and environment changes stay the engine's alone
	expect(prose).toContain(
		'Do not run builds, tests, linters, formatters, package-manager commands, Git commands, network commands, or any other verification or environment-changing command',
	);
	// file inspection and editing are explicitly allowed, by whatever tooling the harness has
	expect(prose).toContain("Use the harness's file tools to read");
	expect(prose).toContain(
		'If the harness exposes the filesystem only through a shell, use the shell solely to inspect and edit files — never for repository commands.',
	);
	// the granted-commands exception survives beside it
	expect(prose).toContain('Sole exception: commands listed under a `# Granted commands` section');
	// the old blanket ban is gone — on Codex it read as "you cannot read or edit files"
	expect(prose).not.toContain('Do not run shell commands');
});

test('buildFeatureExecutorInvocation: the resolved file limit is substituted into the executor stop rule rather than hard-coded in it', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, fileLimit: 200 });

	// the plan's own budget is the number the executor is held to
	expect(systemPrompt.includes('more than 200 source files')).toBeTruthy();
	// the number the prompt used to hard-code is gone
	expect(systemPrompt.includes('more than 50 source files')).toBeFalsy();
	// no token survives into what the agent reads
	expect(systemPrompt.includes('{{')).toBeFalsy();
});

test('buildFeatureExecutorInvocation: an absent file limit falls back to the engine default', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent });

	// a run with neither a plan budget nor a configured limit still states a number
	expect(systemPrompt.includes('more than 50 source files')).toBeTruthy();
	expect(systemPrompt.includes('{{fileLimit}}')).toBeFalsy();
});

test('buildFeatureExecutorInvocation: a different file limit is the only thing the substitution changes', () => {
	const lower = buildFeatureExecutorInvocation({ planContent, fileLimit: 12 });
	const higher = buildFeatureExecutorInvocation({ planContent, fileLimit: 200 });

	// the two role prompts differ only where the token stood
	expect(lower.systemPrompt.replace('more than 12 source files', 'more than 200 source files')).toBe(higher.systemPrompt);
	// and the user prompt is untouched by the limit
	expect(lower.prompt).toBe(higher.prompt);
});
