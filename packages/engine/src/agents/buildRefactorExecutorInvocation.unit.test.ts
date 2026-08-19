import { expect, test } from '@jest/globals';
import { buildRefactorExecutorInvocation } from '@/agents';
import { type StandardsFinding, StandardsSeverity } from '@/contracts';

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
	const { systemPrompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Refactor Executor')).toBeTruthy();
	expect(systemPrompt.includes(`\n\n---\n\n# Plan (context for what these changes were for)\n\n${planContent}`)).toBeTruthy();
	expect(systemPrompt.includes(`# Standards\n\nThese rules are binding:\n\n${standards}`)).toBeTruthy();
});

test('buildRefactorExecutorInvocation: no standards section when standards are absent', () => {
	const { systemPrompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'] });

	// the standards section is omitted, not emptied
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the system prompt is byte-identical across refactor passes', () => {
	const first = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });
	const later = buildRefactorExecutorInvocation({
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
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts', 'src/other.ts'], standards });

	// the role marker the engine classifies on leads the prompt
	expect(prompt.startsWith('# Changed files to review\n\n- src/widget.ts\n- src/other.ts')).toBeTruthy();
	// a clean tree injects no findings section
	expect(prompt.includes('# Standards findings')).toBeFalsy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON report object')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: findings and advisories render as rule bullets under one standards section', () => {
	const { prompt } = buildRefactorExecutorInvocation({
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

test('buildRefactorExecutorInvocation: a multi-site finding renders every location with its line span, joined by the clone marker', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [
			finding({
				rule: 'clone',
				siteKey: 'widget-clone',
				files: [
					{ path: 'src/widget.ts', startLine: 12, endLine: 40 },
					{ path: 'src/other.ts', startLine: 7 },
				],
				detail: '28 duplicated lines',
			}),
		],
	});

	// both sites ride the bullet, each rendered as path:start[-end]
	expect(prompt.includes('- [clone] src/widget.ts:12-40 ↔ src/other.ts:7 — 28 duplicated lines')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: each finding gets its own bullet line', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts', 'src/other.ts'],
		findings: [finding(), finding({ siteKey: 'other', files: [{ path: 'src/other.ts', startLine: 3 }], detail: 'export name collides' })],
	});

	// the work-list is one finding per line, in the order handed in
	expect(prompt.includes('- [multi-export] src/widget.ts — file exceeds the size cap\n- [multi-export] src/other.ts:3 — export name collides')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: a findings-only run renders without the advisory framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], findings: [finding()], advisories: [] });

	expect(prompt.includes('# Standards findings (deterministic checks)')).toBeTruthy();
	expect(prompt.includes('- [multi-export] src/widget.ts — file exceeds the size cap')).toBeTruthy();
	// no advisory framing without advisories
	expect(prompt.includes('Advisory — judge each against')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: an advisories-only run renders without the blocking-findings framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({
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
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], findings: [], advisories: [] });

	// empty lists behave like absent lists
	expect(prompt.includes('# Standards findings')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the verification-failure section rides the user prompt, only on a fix re-invocation', () => {
	const clean = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'] });
	const fix = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	expect(clean.prompt.includes('# Verification failure')).toBeFalsy();
	expect(fix.prompt.includes('# Verification failure')).toBeTruthy();
	// the gate output lands verbatim
	expect(fix.prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: the standards findings precede the verification failure, and the report reminder closes the prompt', () => {
	const { prompt } = buildRefactorExecutorInvocation({
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
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	// the plan is paid for once, in the cached system prompt
	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the advisory-outcomes section is opt-in — callers that record nothing never ask for it', () => {
	const advisories = [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory })];
	const silent = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], advisories });
	const asking = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], advisories, reportAdvisoryOutcomes: true });

	// asking for a field nothing persists would be prompt noise
	expect(silent.prompt.includes('# Report what you did about each advisory')).toBeFalsy();
	expect(asking.prompt.includes('# Report what you did about each advisory')).toBeTruthy();
	// with the shape it wants back
	expect(asking.prompt.includes('"advisoryOutcomes"')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: with no advisory to answer for, the section is omitted even when asked for', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [finding()],
		advisories: [],
		reportAdvisoryOutcomes: true,
	});

	expect(prompt.includes('# Report what you did about each advisory')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: a pass that was handed no advisory list at all is never asked to answer for one', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		findings: [finding()],
		reportAdvisoryOutcomes: true,
	});

	// an omitted list is the same nothing as an empty one
	expect(prompt.includes('# Report what you did about each advisory')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the advisory-outcomes ask names the two outcomes the report contract accepts, and the fields to echo', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		advisories: [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory })],
		reportAdvisoryOutcomes: true,
	});

	// an outcome word the contract's enum does not accept fails the report and loses the record
	expect(prompt.includes('"applied"')).toBeTruthy();
	expect(prompt.includes('"declined"')).toBeTruthy();
	// the health report ties an entry back to its rule by these two fields, copied not invented
	expect(prompt.includes('`rule` and `siteKey` copied exactly as given')).toBeTruthy();
	// and the worked example carries the same field names the parser reads
	expect(
		prompt.includes(
			'{ "rule": "size-function", "siteKey": "size-function:src/example.ts", "outcome": "declined", "reason": "orchestration exemption applies — every step delegates" }',
		),
	).toBeTruthy();
});

test('buildRefactorExecutorInvocation: asking for advisory outcomes leaves the cached system prompt untouched', () => {
	const advisories = [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory })];
	const silent = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], standards, advisories });
	const asking = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], standards, advisories, reportAdvisoryOutcomes: true });

	// the ask varies per caller, so it rides the user prompt or it breaks the cached prefix
	expect(asking.systemPrompt).toBe(silent.systemPrompt);
});

test('buildRefactorExecutorInvocation: the advisory-outcomes ask follows the advisories it is about', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		advisories: [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory })],
		reportAdvisoryOutcomes: true,
		errorContext: 'GATE-SENTINEL',
	});

	// it names "the advisories listed above", so it has to sit under them
	expect(prompt.indexOf('# Standards findings (deterministic checks)')).toBeLessThan(prompt.indexOf('# Report what you did about each advisory'));
	// and before the gate output, which is why this pass is a retry
	expect(prompt.indexOf('# Report what you did about each advisory')).toBeLessThan(prompt.indexOf('# Verification failure'));
});
