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

test('buildFeatureExecutorInvocation: the acceptance tests ride the user prompt, and say what they are for', () => {
	const rows = [
		{ testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label' },
		{ testFile: 'src/flag.unit.test.ts', testName: 'flag: is off by default' },
	];
	const clean = buildFeatureExecutorInvocation({ planContent });
	const named = buildFeatureExecutorInvocation({ planContent, acceptanceTests: rows });

	// a plan with no ledger gets no section at all
	expect(clean.prompt.includes('# Acceptance tests')).toBeFalsy();
	expect(buildFeatureExecutorInvocation({ planContent, acceptanceTests: [] }).prompt.includes('# Acceptance tests')).toBeFalsy();
	// each row gets its own bullet, naming the case and the file stating it
	expect(named.prompt.includes('- `widget: renders its label` in src/widget.unit.test.ts')).toBeTruthy();
	expect(named.prompt.includes('- `flag: is off by default` in src/flag.unit.test.ts')).toBeTruthy();
	// the executor is told these are the bar, and what an edit to one is judged by
	expect(named.prompt.includes('Every one of them must execute and pass before the work is done.')).toBeTruthy();
	expect(named.prompt.includes('Every edit to a test file is reviewed against the plan before any gate runs.')).toBeTruthy();
	// the report-contract reminder still closes the prompt
	expect(named.prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: the acceptance rows never enter the cached system prompt', () => {
	const first = buildFeatureExecutorInvocation({ planContent, overviewContent, standards });
	const named = buildFeatureExecutorInvocation({
		planContent,
		overviewContent,
		standards,
		acceptanceTests: [{ testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label' }],
	});

	// the mapping is resolved per invocation — a disposition rewrites it mid-run —
	// so it must not break the prefix the harness caches across a run
	expect(first.systemPrompt).toBe(named.systemPrompt);
});

test('buildFeatureExecutorInvocation: the user prompt orders changed files, the acceptance tests, then the gate output', () => {
	const { prompt } = buildFeatureExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		acceptanceTests: [{ testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label' }],
		errorContext: 'GATE-SENTINEL',
	});

	// a fix re-invocation carrying all three reads them in one fixed order
	expect(
		prompt.indexOf('# Previously changed files') < prompt.indexOf('# Acceptance tests') &&
			prompt.indexOf('# Acceptance tests') < prompt.indexOf('# Verification failure'),
	).toBeTruthy();
	// the acceptance rows stay out of the changed-file list they follow
	expect(
		prompt.includes('# Previously changed files\n\nFiles already created or modified earlier in this run:\n\n- src/widget.ts\n\n# Acceptance tests'),
	).toBeTruthy();
});

test('buildFeatureExecutorInvocation: the role prompt states that a test edit is reviewed, and what the review refuses', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent });
	// the prompt wraps its lines; the sentences are what matter
	const prose = systemPrompt.replace(/\s+/g, ' ');

	// the rule names the same section heading the user prompt emits
	expect(prose).toContain('Tests listed under an `# Acceptance tests` section in your task are what the plan means by done');
	// a stale test file is repairable, which is what the old lock made impossible
	expect(prose).toContain("You may edit a test file when the plan's own changes make it stale");
	// and the judgment that bounds it is named
	expect(prose).toContain('Every edit to a test file is reviewed against the plan before any gate runs');
	// the one legitimate escape from a test that cannot pass is a report, not an edit
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

test('buildFeatureExecutorInvocation: the acceptance section names every edit the review refuses, so the executor knows the bar before it edits a test', () => {
	const { prompt } = buildFeatureExecutorInvocation({
		planContent,
		acceptanceTests: [{ testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label' }],
	});

	// the section says what the rows are for
	expect(prompt).toContain("These state the plan's acceptance criteria — what this run means by done:");
	// every refusal the reviewer enforces is named, so none is a surprise at the checkpoint
	expect(prompt).toContain('a weakened or removed assertion');
	expect(prompt).toContain('an acceptance test deleted, renamed, skipped or replaced without a disposition the plan backs');
	expect(prompt).toContain('a mock that neuters the subject under test');
	expect(prompt).toContain('a snapshot rewrite that hides a behaviour change the plan did not authorise');
	expect(prompt).toContain('configuration that stops a test from being collected');
	// and a move is only legitimate when it loses nothing
	expect(prompt).toContain('- A moved test file carries every case its source held.');
});

test('buildFeatureExecutorInvocation: the acceptance section says nothing about a file being locked — a stale test is repairable', () => {
	const { prompt } = buildFeatureExecutorInvocation({
		planContent,
		acceptanceTests: [{ testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label' }],
	});

	// the whole-file lock the review replaced left no read-only wording behind
	expect(prompt).not.toContain('read-only');
	expect(prompt).not.toContain('locked');
	// what replaced it is the permission plus the judgment
	expect(prompt).toContain("A test file may be edited when the plan's own changes make it stale");
});
