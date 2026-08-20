import { expect, test } from '@jest/globals';
import { buildPlanDedupInvocation } from '#src/agents/index.ts';

const planText = '# Phase 1\n\nPLAN-SENTINEL';
const overviewText = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const candidates = () => [{ plannedSymbol: 'formatDate', collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }] }];

test('buildPlanDedupInvocation: the system prompt carries the role, the overview, and the code standards', () => {
	const { systemPrompt } = buildPlanDedupInvocation({ planText, overviewText, candidates: candidates(), standards });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Judge Plan Dedup')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (context only — do not judge standalone)\n\n${overviewText}`)).toBeTruthy();
	expect(
		systemPrompt.includes(`# Code standards\n\nThe implementing agent loads these too — factor them into extract/reuse recommendations:\n\n${standards}`),
	).toBeTruthy();
});

test('buildPlanDedupInvocation: overview and standards sections are omitted when absent', () => {
	const { systemPrompt } = buildPlanDedupInvocation({ planText, candidates: candidates() });

	// no overview section for a single-file plan
	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	// no standards section when standards are absent
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
});

test('buildPlanDedupInvocation: the system prompt is byte-identical across judgments in one run', () => {
	const first = buildPlanDedupInvocation({ planText, overviewText, candidates: candidates(), standards });
	const second = buildPlanDedupInvocation({
		planText: '# Phase 2\n\nsomething else entirely',
		overviewText,
		candidates: [{ plannedSymbol: 'parseAction', collidesWith: [{ name: 'parseAction', path: 'src/common/utils/parseAction.ts' }] }],
		standards,
	});

	// neither the plan nor the collisions can break the cached prefix
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPlanDedupInvocation: the user prompt carries the plan and each detected collision as a bullet', () => {
	const { prompt } = buildPlanDedupInvocation({
		planText,
		overviewText,
		candidates: [
			{
				plannedSymbol: 'formatDate',
				collidesWith: [
					{ name: 'formatDate', path: 'a.ts' },
					{ name: 'formatDate', path: 'b.ts' },
				],
			},
		],
		standards,
	});

	// the marker runPlanDedup keys dedup invocations off
	expect(prompt.startsWith('# Dedup input')).toBeTruthy();
	expect(prompt.includes(`## Plan to judge\n\n${planText}`)).toBeTruthy();
	expect(prompt.includes('## Detected name collisions\n\n- `formatDate` collides with: formatDate → a.ts; formatDate → b.ts')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON DedupJudgment object')).toBeTruthy();
	// the overview is paid for once, in the cached system prompt
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});

test('buildPlanDedupInvocation: each detected collision is its own bullet line', () => {
	const { prompt } = buildPlanDedupInvocation({
		planText,
		candidates: [
			{ plannedSymbol: 'formatDate', collidesWith: [{ name: 'formatDate', path: 'a.ts' }] },
			{ plannedSymbol: 'parseAction', collidesWith: [{ name: 'parseAction', path: 'b.ts' }] },
		],
	});

	expect(
		prompt.includes('## Detected name collisions\n\n- `formatDate` collides with: formatDate → a.ts\n- `parseAction` collides with: parseAction → b.ts'),
	).toBeTruthy();
});

test('buildPlanDedupInvocation: an empty collision list renders the section with no bullets', () => {
	const { prompt } = buildPlanDedupInvocation({ planText, candidates: [] });

	// the judge still sees the section it rules on
	expect(prompt.includes('## Detected name collisions')).toBeTruthy();
	// nothing detected means no bullets
	expect(prompt.includes('collides with:')).toBeFalsy();
	// the report-contract reminder still closes the prompt
	expect(prompt.includes('one JSON DedupJudgment object')).toBeTruthy();
});

test('buildPlanDedupInvocation: the standards close the system prompt when there is no overview', () => {
	const { systemPrompt } = buildPlanDedupInvocation({ planText, candidates: candidates(), standards });

	// no overview section for a single-file plan
	expect(systemPrompt.includes('# Overview (context only')).toBeFalsy();
	// the standards join straight onto the role prompt
	expect(
		systemPrompt.endsWith(
			`\n\n---\n\n# Code standards\n\nThe implementing agent loads these too — factor them into extract/reuse recommendations:\n\n${standards}`,
		),
	).toBeTruthy();
});

test('buildPlanDedupInvocation: the overview closes the system prompt when standards are absent', () => {
	const { systemPrompt } = buildPlanDedupInvocation({ planText, overviewText, candidates: candidates() });

	// no standards section when standards are absent
	expect(systemPrompt.includes('# Code standards')).toBeFalsy();
	// the overview joins straight onto the role prompt
	expect(systemPrompt.endsWith(`\n\n---\n\n# Overview (context only — do not judge standalone)\n\n${overviewText}`)).toBeTruthy();
});
