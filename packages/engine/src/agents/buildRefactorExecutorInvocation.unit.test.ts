import { expect, test } from '@jest/globals';
import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';

// The cases below are about everything EXCEPT the scope section, so they all
// pick one and hold it fixed; the two tests that are about the scope section
// name their own.
const scope = RefactorScope.Feature;
const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: 'multi-export',
	severity: StandardsSeverity.Blocking,
	siteKey: 'widget',
	files: [{ path: 'src/widget.ts' }],
	detail: 'file exceeds the size cap',
	...overrides,
});

test('buildRefactorExecutorInvocation: the system prompt carries the role, the plan, and the standards', () => {
	const { systemPrompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], standards });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Refactor Executor')).toBeTruthy();
	expect(systemPrompt.includes(`\n\n---\n\n# Plan (context for what these changes were for)\n\n${planContent}`)).toBeTruthy();
	expect(systemPrompt.includes(`# Standards\n\nThese rules are binding:\n\n${standards}`)).toBeTruthy();
});

test('buildRefactorExecutorInvocation: no standards section when standards are absent', () => {
	const { systemPrompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'] });

	// the standards section is omitted, not emptied
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the system prompt is byte-identical across refactor passes', () => {
	const first = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], standards });
	const later = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts', 'src/other.ts'],
		standards,
		findings: [finding()],
		advisories: [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory })],
		errorContext: 'check failed',
	});

	// growing review lists and findings cannot break the cached prefix
	expect(first.systemPrompt).toBe(later.systemPrompt);
});

test('buildRefactorExecutorInvocation: the user prompt leads with the review list and closes with the report reminder', () => {
	const { prompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts', 'src/other.ts'], standards });

	// the role marker the engine classifies on leads the prompt
	expect(prompt.startsWith('# Changed files to review\n\n- src/widget.ts\n- src/other.ts')).toBeTruthy();
	// a clean tree injects no findings section
	expect(prompt.includes('# Standards findings')).toBeFalsy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON report object')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: findings and advisories render as rule bullets under one standards section', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [finding()],
		advisories: [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory, detail: 'function exceeds 50 lines' })],
	});

	expect(prompt.includes('# Standards findings (deterministic checks)')).toBeTruthy();
	expect(prompt.includes('- [multi-export] src/widget.ts — file exceeds the size cap')).toBeTruthy();
	// an advisory carries its siteKey verbatim — the report demands it "copied
	// exactly as given", so the prompt has to actually give it
	expect(prompt.includes('- [size-function] src/widget.ts — function exceeds 50 lines (siteKey: `widget`)')).toBeTruthy();
	// advisories keep their non-blocking framing
	expect(prompt.includes('Advisory — judge each against')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: the blocking findings lead the standards section and the advisories follow under the same heading', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [finding()],
		advisories: [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory, detail: 'function exceeds 50 lines' })],
	});

	// one heading for both lists — a second heading reads as a second work-list
	expect(prompt.split('# Standards findings (deterministic checks)').length).toBe(2);
	// the blocking work is what the agent must address first, so it is what it reads first
	expect(prompt.indexOf('Address each one first')).toBeLessThan(prompt.indexOf('Advisory — judge each against'));
});

test("buildRefactorExecutorInvocation: a finding's guidance rides its bullet, after the measurement", () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts'],
		advisories: [
			finding({
				rule: 'size-function',
				severity: StandardsSeverity.Advisory,
				detail: "function 'one' is 114 lines (cap ~80)",
				guidance: 'Extract logic. Orchestration that only sequences step calls is exempt.',
			}),
		],
	});

	// without the guidance the agent reads a bare line count and rewrites the
	// orchestration the rule meant to spare
	expect(
		prompt.includes(
			"- [size-function] src/widget.ts — function 'one' is 114 lines (cap ~80) — Extract logic. Orchestration that only sequences step calls is exempt.",
		),
	).toBeTruthy();
});

test('buildRefactorExecutorInvocation: a multi-site finding renders every location with its line span, joined by the duplication marker', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [
			finding({
				rule: 'duplicate-code-block',
				siteKey: 'duplicate-code-block:src/widget.ts|src/other.ts',
				files: [
					{ path: 'src/widget.ts', startLine: 12, endLine: 40 },
					{ path: 'src/other.ts', startLine: 7 },
				],
				detail: '28 duplicated lines',
			}),
		],
	});

	// both sites ride the bullet, each rendered as path:start[-end]
	expect(prompt.includes('- [duplicate-code-block] src/widget.ts:12-40 ↔ src/other.ts:7 — 28 duplicated lines')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: each finding gets its own bullet line', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts', 'src/other.ts'],
		findings: [finding(), finding({ siteKey: 'other', files: [{ path: 'src/other.ts', startLine: 3 }], detail: 'export name collides' })],
	});

	// the work-list is one finding per line, in the order handed in
	expect(prompt.includes('- [multi-export] src/widget.ts — file exceeds the size cap\n- [multi-export] src/other.ts:3 — export name collides')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: a findings-only run renders without the advisory framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], findings: [finding()], advisories: [] });

	expect(prompt.includes('# Standards findings (deterministic checks)')).toBeTruthy();
	expect(prompt.includes('- [multi-export] src/widget.ts — file exceeds the size cap')).toBeTruthy();
	// no advisory framing without advisories
	expect(prompt.includes('Advisory — judge each against')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: an advisories-only run renders without the blocking-findings framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [],
		advisories: [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory, detail: 'function exceeds 50 lines' })],
	});

	expect(prompt.includes('# Standards findings (deterministic checks)')).toBeTruthy();
	expect(prompt.includes('- [size-function] src/widget.ts — function exceeds 50 lines')).toBeTruthy();
	// no blocking framing without findings
	expect(prompt.includes('Address each one first')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: empty finding lists inject no findings section', () => {
	const { prompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], findings: [], advisories: [] });

	// empty lists behave like absent lists
	expect(prompt.includes('# Standards findings')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the verification-failure section rides the user prompt, only on a fix re-invocation', () => {
	const clean = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'] });
	const fix = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	expect(clean.prompt.includes('# Verification failure')).toBeFalsy();
	expect(fix.prompt.includes('# Verification failure')).toBeTruthy();
	// the gate output lands verbatim
	expect(fix.prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: the standards findings precede the verification failure, and the report reminder closes the prompt', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [finding()],
		errorContext: 'GATE-SENTINEL',
	});

	// the work-list is what the pass is for; the gate output is why this pass is a retry
	expect(prompt.indexOf('# Standards findings (deterministic checks)')).toBeLessThan(prompt.indexOf('# Verification failure'));
	// a reminder with sections after it stops being the last thing the agent reads
	expect(prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: neither the plan nor the standards appear in the user prompt', () => {
	const { prompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], standards });

	// the plan is paid for once, in the cached system prompt
	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the command ban names what is banned and leaves file access open — a harness whose only file access is a shell must not read it as "touch nothing"', () => {
	const { systemPrompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'] });
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
	// the old blanket ban is gone — on Codex it read as "you cannot read or edit files"
	expect(prose).not.toContain('Do not run shell commands');
});

test('buildRefactorExecutorInvocation: a feature scope forbids the files outside its list, a standalone scope allows what a fix needs', () => {
	const feature = buildRefactorExecutorInvocation({ scope: RefactorScope.Feature, planContent, changedFiles: ['src/widget.ts'] });
	const standalone = buildRefactorExecutorInvocation({ scope: RefactorScope.Standalone, planContent, changedFiles: ['src/widget.ts'] });

	// the fence, stated only to the caller whose branch a reviewer reads as a feature
	expect(feature.systemPrompt.includes('Never refactor a file outside the listed set.')).toBeTruthy();
	expect(standalone.systemPrompt.includes('Never refactor a file outside the listed set.')).toBeFalsy();

	// and the permission, stated only to the caller invoked to reorganize
	expect(standalone.systemPrompt.includes('They are not a fence.')).toBeTruthy();
	expect(feature.systemPrompt.includes('They are not a fence.')).toBeFalsy();

	// what neither scope may do is identical in both
	expect(feature.systemPrompt.includes('Never change behavior or add functionality.')).toBeTruthy();
	expect(standalone.systemPrompt.includes('Never change behavior or add functionality.')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: the work-list heading matches what the files actually are', () => {
	const feature = buildRefactorExecutorInvocation({ scope: RefactorScope.Feature, planContent, changedFiles: ['src/widget.ts'] });
	const standalone = buildRefactorExecutorInvocation({ scope: RefactorScope.Standalone, planContent, changedFiles: ['src/widget.ts'] });

	// nothing has changed yet in a standalone run, so calling them changed files
	// would be a false description of the only list the agent is given
	expect(feature.prompt.startsWith('# Changed files to review')).toBeTruthy();
	expect(standalone.prompt.startsWith('# Files the findings name')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: a phased run carries the overview ahead of the plan, so "no caller yet" reads as early rather than dead', () => {
	const { systemPrompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		overviewContent: '# Ten phases\n\nOVERVIEW-SENTINEL',
		changedFiles: ['src/widget.ts'],
	});

	expect(systemPrompt).toContain('OVERVIEW-SENTINEL');
	// the overview reframes the plan, so it has to arrive first
	expect(systemPrompt.indexOf('OVERVIEW-SENTINEL')).toBeLessThan(systemPrompt.indexOf('PLAN-SENTINEL'));
	expect(systemPrompt).toContain('a thing with no caller yet is not necessarily dead');
});

test('buildRefactorExecutorInvocation: a single-phase run has no overview section at all', () => {
	const { systemPrompt } = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'] });

	expect(systemPrompt).not.toContain('# Overview (high-level context)');
});

test('buildRefactorExecutorInvocation: the overview rides the cached system prompt, never the per-pass user prompt', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
		planContent,
		overviewContent: '# Ten phases\n\nOVERVIEW-SENTINEL',
		changedFiles: ['src/widget.ts'],
	});

	expect(prompt).not.toContain('OVERVIEW-SENTINEL');
});

test('carries the self-check section, and a standing ban naming the sole exception the other executors carry', () => {
	const selfCheckCommand = 'node /repo/plugin/dist/cli.mjs self-check --run run-42 --cwd "/repo"';
	const without = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], standards });
	const granted = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], standards, selfCheckCommand });

	// a spawn given no self-check reads exactly what it read before, so the
	// section is what the granted spawn adds after the standards — asserting on
	// that slice keeps every claim below about the section itself
	expect(granted.systemPrompt.startsWith(without.systemPrompt)).toBeTruthy();
	const section = granted.systemPrompt.slice(without.systemPrompt.length).replace(/\s+/g, ' ');

	// the granted command lands verbatim — an agent that has to reassemble it
	// runs something the harness never allowed
	expect(section).toContain(selfCheckCommand);
	// what its exit codes mean, so a red reads as red
	expect(section).toMatch(/exit/i);
	// the stop rule, and the cap that stops a loop no repeat would ever end
	expect(section).toMatch(/identical/i);
	expect(section).toMatch(/three times/i);
	// a still-red check is friction on a complete report, never a failed one
	expect(section).toMatch(/friction/i);
	// the engine's gates run afterwards and are the only verdict
	expect(section).toMatch(/only verdict/i);

	// the standing ban now carries the sole-exception clause the feature
	// executor's and direct worker's prompts already carry, covering both the
	// consumer's granted commands and the engine's own self-check
	const prose = without.systemPrompt.replace(/\s+/g, ' ');
	expect(prose).toContain('Sole exception');
	expect(prose).toContain('# Granted commands');
	expect(prose).toContain('self-check');
});
