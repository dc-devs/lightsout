import { expect, test } from '@jest/globals';
import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';

// The advisory-outcomes ask: when it is emitted, what it asks for, and where it
// sits. Split from the builder's other cases so neither file has to be read
// whole to answer a question about the other.
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

test('buildRefactorExecutorInvocation: the advisory-outcomes section is opt-in — callers that record nothing never ask for it', () => {
	const advisories = [finding({ rule: 'size-function', severity: StandardsSeverity.Advisory })];
	const silent = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], advisories });
	const asking = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], advisories, reportAdvisoryOutcomes: true });

	// asking for a field nothing persists would be prompt noise
	expect(silent.prompt.includes('# Report what you did about each advisory')).toBeFalsy();
	expect(asking.prompt.includes('# Report what you did about each advisory')).toBeTruthy();
	// with the shape it wants back
	expect(asking.prompt.includes('"advisoryOutcomes"')).toBeTruthy();
});

test('buildRefactorExecutorInvocation: with no advisory to answer for, the section is omitted even when asked for', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
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
		scope,
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
		scope,
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
	const silent = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], standards, advisories });
	const asking = buildRefactorExecutorInvocation({ scope, planContent, changedFiles: ['src/widget.ts'], standards, advisories, reportAdvisoryOutcomes: true });

	// the ask varies per caller, so it rides the user prompt or it breaks the cached prefix
	expect(asking.systemPrompt).toBe(silent.systemPrompt);
});

test('buildRefactorExecutorInvocation: the advisory-outcomes ask follows the advisories it is about', () => {
	const { prompt } = buildRefactorExecutorInvocation({
		scope,
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
