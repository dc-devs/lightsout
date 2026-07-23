import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@lightsout/contracts';
import { buildRefactorExecutorInvocation } from './index';

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

	assert.ok(systemPrompt.startsWith('# Role: Refactor Executor'), 'the role prompt leads the system prompt');
	assert.ok(systemPrompt.includes(`\n\n---\n\n# Plan (context for what these changes were for)\n\n${planContent}`));
	assert.ok(systemPrompt.includes(`# Standards\n\nThese rules are binding:\n\n${standards}`));
});

test('buildRefactorExecutorInvocation: no standards section when standards are absent', () => {
	const { systemPrompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'] });

	assert.ok(!systemPrompt.includes('# Standards\n\nThese rules are binding'), 'the standards section is omitted, not emptied');
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

	assert.equal(first.systemPrompt, later.systemPrompt, 'growing review lists and findings cannot break the cached prefix');
});

test('buildRefactorExecutorInvocation: the user prompt leads with the review list and closes with the report reminder', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts', 'src/other.ts'], standards });

	assert.ok(prompt.startsWith('# Changed files to review\n\n- src/widget.ts\n- src/other.ts'), 'the role marker the engine classifies on leads the prompt');
	assert.ok(!prompt.includes('# Scan findings'), 'a clean tree injects no findings section');
	assert.ok(prompt.includes('one JSON report object'), 'the report-contract reminder closes the prompt');
});

test('buildRefactorExecutorInvocation: findings and advisories render as detector bullets under one scan section', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		scanFindings: [finding()],
		scanAdvisories: [finding({ detector: ScanDetector.Size, severity: ScanSeverity.Advisory, detail: 'function exceeds 50 lines' })],
	});

	assert.ok(prompt.includes('# Scan findings (deterministic detectors)'));
	assert.ok(prompt.includes('- [structure] src/widget.ts — file exceeds the size cap'));
	assert.ok(prompt.includes('- [size] src/widget.ts — function exceeds 50 lines'));
	assert.ok(prompt.includes('Advisory — judge each against'), 'advisories keep their non-blocking framing');
});

test('buildRefactorExecutorInvocation: a findings-only scan renders without the advisory framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], scanFindings: [finding()], scanAdvisories: [] });

	assert.ok(prompt.includes('# Scan findings (deterministic detectors)'));
	assert.ok(prompt.includes('- [structure] src/widget.ts — file exceeds the size cap'));
	assert.ok(!prompt.includes('Advisory — judge each against'), 'no advisory framing without advisories');
});

test('buildRefactorExecutorInvocation: an advisories-only scan renders without the blocking-findings framing', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		planContent,
		changedFiles: ['src/widget.ts'],
		scanFindings: [],
		scanAdvisories: [finding({ detector: ScanDetector.Size, severity: ScanSeverity.Advisory, detail: 'function exceeds 50 lines' })],
	});

	assert.ok(prompt.includes('# Scan findings (deterministic detectors)'));
	assert.ok(prompt.includes('- [size] src/widget.ts — function exceeds 50 lines'));
	assert.ok(!prompt.includes('Address each one first'), 'no blocking framing without findings');
});

test('buildRefactorExecutorInvocation: empty scan lists inject no findings section', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], scanFindings: [], scanAdvisories: [] });

	assert.ok(!prompt.includes('# Scan findings'), 'empty lists behave like absent lists');
});

test('buildRefactorExecutorInvocation: the verification-failure section rides the user prompt, only on a fix re-invocation', () => {
	const clean = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'] });
	const fix = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	assert.ok(!clean.prompt.includes('# Verification failure'));
	assert.ok(fix.prompt.includes('# Verification failure'));
	assert.ok(fix.prompt.includes('GATE-SENTINEL'), 'the gate output lands verbatim');
});

test('buildRefactorExecutorInvocation: neither the plan nor the standards appear in the user prompt', () => {
	const { prompt } = buildRefactorExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	assert.ok(!prompt.includes('PLAN-SENTINEL'), 'the plan is paid for once, in the cached system prompt');
	assert.ok(!prompt.includes('STANDARDS-SENTINEL'), 'the standards are paid for once, in the cached system prompt');
});
