import { expect, test } from '@jest/globals';
import { buildPromptImproverInvocation } from '#src/agents/index.ts';
import type { FrictionRecord } from '#src/contracts/index.ts';

const record = (overrides: Partial<FrictionRecord> = {}): FrictionRecord => ({
	kind: 'friction',
	area: 'prompt',
	detail: 'The role prompt contradicted the plan on where tests live.',
	at: '2026-08-04T12:00:00.000Z',
	runId: '0123456789abcdef',
	step: 'unitTests',
	...overrides,
});

const promptFiles = () => ['src/agents/prompts/featureExecutor.md', 'src/agents/prompts/unitTestWriter.md'];

test('buildPromptImproverInvocation: the system prompt is the prompt-improver role prompt alone', () => {
	const { systemPrompt } = buildPromptImproverInvocation({ friction: [record()], promptFiles: promptFiles() });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Prompt Improver')).toBeTruthy();
	// friction details never leak into the cached prefix
	expect(systemPrompt.includes('The role prompt contradicted the plan')).toBeFalsy();
});

test('buildPromptImproverInvocation: the system prompt is byte-identical across improvement runs', () => {
	const first = buildPromptImproverInvocation({ friction: [record()], promptFiles: promptFiles() });
	const second = buildPromptImproverInvocation({
		friction: [record({ area: 'environment', detail: 'something else entirely', runId: 'ffffffffffff' })],
		promptFiles: ['src/agents/prompts/supervisor.md'],
	});

	// neither the friction nor the prompt files can break the cached prefix
	expect(first.systemPrompt).toBe(second.systemPrompt);
});

test('buildPromptImproverInvocation: each friction record renders as a bullet with kind, area, provenance, and detail', () => {
	const { prompt } = buildPromptImproverInvocation({ friction: [record()], promptFiles: promptFiles() });

	// the friction section leads the user prompt
	expect(prompt.startsWith('# Friction reports')).toBeTruthy();
	// the bullet carries every field, with the run id truncated to its first 8
	// characters
	expect(
		prompt.includes('- [friction/prompt] (run 01234567, step unitTests, 2026-08-04T12:00:00.000Z) The role prompt contradicted the plan on where tests live.'),
	).toBeTruthy();
});

test('buildPromptImproverInvocation: a record with no kind is reported as friction', () => {
	const { prompt } = buildPromptImproverInvocation({
		friction: [record({ kind: undefined, area: 'plan', detail: 'The plan was silent on the output path.' })],
		promptFiles: promptFiles(),
	});

	expect(prompt.includes('- [friction/plan] (run 01234567, step unitTests, 2026-08-04T12:00:00.000Z) The plan was silent on the output path.')).toBeTruthy();
});

test('buildPromptImproverInvocation: a decision record keeps its own kind', () => {
	const { prompt } = buildPromptImproverInvocation({
		friction: [record({ kind: 'decision', area: 'standards', detail: 'Chose node:test over jest.' })],
		promptFiles: promptFiles(),
	});

	expect(prompt.includes('- [decision/standards] (run 01234567, step unitTests, 2026-08-04T12:00:00.000Z) Chose node:test over jest.')).toBeTruthy();
});

test('buildPromptImproverInvocation: multiple records render one per line, in the order given', () => {
	const { prompt } = buildPromptImproverInvocation({
		friction: [record({ detail: 'first' }), record({ kind: 'decision', area: 'other', runId: 'abcdefghijkl', step: 'implement', detail: 'second' })],
		promptFiles: promptFiles(),
	});

	// records are newline-joined in input order
	expect(
		prompt.includes(
			'- [friction/prompt] (run 01234567, step unitTests, 2026-08-04T12:00:00.000Z) first\n- [decision/other] (run abcdefgh, step implement, 2026-08-04T12:00:00.000Z) second',
		),
	).toBeTruthy();
});

test('buildPromptImproverInvocation: a run id shorter than 8 characters passes through whole', () => {
	const { prompt } = buildPromptImproverInvocation({ friction: [record({ runId: 'abc' })], promptFiles: promptFiles() });

	expect(prompt.includes('(run abc, step unitTests,')).toBeTruthy();
});

test('buildPromptImproverInvocation: the editable prompt files are listed as bullets and the report reminder closes the prompt', () => {
	const { prompt } = buildPromptImproverInvocation({ friction: [record()], promptFiles: promptFiles() });

	expect(prompt.includes('# Prompt files you may edit\n\n- src/agents/prompts/featureExecutor.md\n- src/agents/prompts/unitTestWriter.md')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildPromptImproverInvocation: both sections keep their headings when friction and prompt files are empty', () => {
	const { prompt } = buildPromptImproverInvocation({ friction: [], promptFiles: [] });

	expect(prompt).toBe(
		'# Friction reports\n\n\n\n# Prompt files you may edit\n\n\n\nRemember: your entire final message must be exactly one JSON report object — nothing else.',
	);
});
