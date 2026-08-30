import { expect, test } from '@jest/globals';
import { buildPlanDocsCheckInvocation } from '#src/agents/index.ts';
import type { ConfigDocs } from '#src/contracts/index.ts';

/** The two surfaces every case here declares, with values distinctive enough to spot in the prompt. */
const docs = (): ConfigDocs => [
	{ path: 'README.md', covers: 'The product tour and the index of every other document.' },
	{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
];

/** One implementable plan file, as the grade pass hands it over. */
const planFiles = () => [{ file: 'plan.md', text: '# Plan\n\n## Documentation\n\nThis plan touches `docs/configuration.md`.' }];

test('buildPlanDocsCheckInvocation: the system prompt carries the role text and one bullet per declared surface', () => {
	const invocation = buildPlanDocsCheckInvocation({ planFiles: planFiles(), docs: docs() });

	// the role prompt leads the system prompt
	expect(invocation.systemPrompt.startsWith('# Role: Check Plan Documentation')).toBeTruthy();
	// the surfaces are appended as their own labelled section
	expect(invocation.systemPrompt.includes("# The repository's declared documentation surfaces")).toBeTruthy();
	// each surface carries its path and the line saying what it covers
	expect(invocation.systemPrompt.includes('- `README.md` — The product tour and the index of every other document.')).toBeTruthy();
	expect(invocation.systemPrompt.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
	// the role sections are joined the way every other checker joins them
	expect(invocation.systemPrompt.includes("\n\n---\n\n# The repository's declared documentation surfaces")).toBeTruthy();
});

test('buildPlanDocsCheckInvocation: the overview section appears only when overview text was given', () => {
	const single = buildPlanDocsCheckInvocation({ planFiles: planFiles(), docs: docs() });
	const phased = buildPlanDocsCheckInvocation({ planFiles: planFiles(), overviewText: '# Overview\n\nthe settled breakdown', docs: docs() });

	// a single plan has no overview, so the section is absent rather than empty
	expect(single.systemPrompt.includes('# Overview (context only')).toBeFalsy();
	expect(phased.systemPrompt.includes('# Overview (context only — do not check standalone)')).toBeTruthy();
	expect(phased.systemPrompt.includes('the settled breakdown')).toBeTruthy();
});

test('buildPlanDocsCheckInvocation: the prompt opens with the docs-check marker and carries one section per plan file', () => {
	const invocation = buildPlanDocsCheckInvocation({
		planFiles: [
			{ file: 'phase1-core.md', text: 'the core phase' },
			{ file: 'phase2-extra.md', text: 'the extra phase' },
		],
		docs: docs(),
	});

	// the marker is what tells this spawn apart from a gap-check and a gap-judge
	expect(invocation.prompt.startsWith('# Docs-check input')).toBeTruthy();
	// every implementable file is in view, because the claim is a whole-plan claim
	expect(invocation.prompt.includes('## Plan file: phase1-core.md\n\nthe core phase')).toBeTruthy();
	expect(invocation.prompt.includes('## Plan file: phase2-extra.md\n\nthe extra phase')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(invocation.prompt.endsWith('Remember: your entire final message must be exactly one JSON GapCheckReport object — nothing else.')).toBeTruthy();
});
