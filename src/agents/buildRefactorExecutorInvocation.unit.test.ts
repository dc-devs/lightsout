import { expect, test } from '@jest/globals';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@/contracts';
import { buildRefactorExecutorInvocation } from '@/agents';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const finding = (overrides: Partial<ScanFinding> = {}): ScanFinding => ({
	detector: ScanDetector.Structure,
	severity: ScanSeverity.Finding,
	cluster: 'widget',
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
		scanFindings: [finding()],
		scanAdvisories: [finding({ detector: ScanDetector.Size, severity: ScanSeverity.Advisory })],
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
	expect(prompt.includes('# Scan findings')).toBeFalsy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON report object')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: findings and advisories render as detector bullets under one scan section', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		scanFindings: [finding()],
		scanAdvisories: [finding({ detector: ScanDetector.Size, severity: ScanSeverity.Advisory, detail: 'function exceeds 50 lines' })],
	});

	expect(prompt.includes('# Scan findings (deterministic detectors)')).toBeTruthy();
	expect(prompt.includes('- [structure] src/widget.ts — file exceeds the size cap')).toBeTruthy();
	expect(prompt.includes('- [size] src/widget.ts — function exceeds 50 lines')).toBeTruthy();
	// advisories keep their non-blocking framing
	expect(prompt.includes('Advisory — judge each against')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: a multi-site finding renders every location with its line span, joined by the clone marker', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		scanFindings: [
			finding({
				detector: ScanDetector.Clone,
				cluster: 'widget-clone',
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
		scanFindings: [finding(), finding({ cluster: 'other', files: [{ path: 'src/other.ts', startLine: 3 }], detail: 'export name collides' })],
	});

	// the work-list is one finding per line, in the order handed in
	expect(prompt.includes('- [structure] src/widget.ts — file exceeds the size cap\n- [structure] src/other.ts:3 — export name collides')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: a findings-only scan renders without the advisory framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], scanFindings: [finding()], scanAdvisories: [] });

	expect(prompt.includes('# Scan findings (deterministic detectors)')).toBeTruthy();
	expect(prompt.includes('- [structure] src/widget.ts — file exceeds the size cap')).toBeTruthy();
	// no advisory framing without advisories
	expect(prompt.includes('Advisory — judge each against')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: an advisories-only scan renders without the blocking-findings framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		scanFindings: [],
		scanAdvisories: [finding({ detector: ScanDetector.Size, severity: ScanSeverity.Advisory, detail: 'function exceeds 50 lines' })],
	});

	expect(prompt.includes('# Scan findings (deterministic detectors)')).toBeTruthy();
	expect(prompt.includes('- [size] src/widget.ts — function exceeds 50 lines')).toBeTruthy();
	// no blocking framing without findings
	expect(prompt.includes('Address each one first')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: empty scan lists inject no findings section', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], scanFindings: [], scanAdvisories: [] });

	// empty lists behave like absent lists
	expect(prompt.includes('# Scan findings')).toBeFalsy();
});

test('buildRefactorExecutorInvocation: the verification-failure section rides the user prompt, only on a fix re-invocation', () => {
	const clean = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'] });
	const fix = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	expect(clean.prompt.includes('# Verification failure')).toBeFalsy();
	expect(fix.prompt.includes('# Verification failure')).toBeTruthy();
	// the gate output lands verbatim
	expect(fix.prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: neither the plan nor the standards appear in the user prompt', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	// the plan is paid for once, in the cached system prompt
	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});
