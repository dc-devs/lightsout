import { expect, test } from '@jest/globals';
import { buildTestChangeReviewInvocation } from '#src/agents/index.ts';

/** Every markdown heading line in a prompt — one per section the builder actually emitted. */
const headingsOf = (text: string): string[] => text.split('\n').filter((line) => /^#{1,6} /.test(line));

/**
 * A checkpoint of a plan that names no acceptance test at all: the mapping is
 * empty, so the section that lists the rows has nothing to list. Everything else
 * — the checkpoint, the changed source files and the bundle — is present, so a
 * section that went missing is the empty mapping's doing and nothing else's.
 */
const setupReviewWithoutRows = () => {
	const planContent = 'Plan: a phase whose ledger names no acceptance test. PLAN-SENTINEL';
	const changedFiles = ['src/widgetSource.ts'];
	const changes = [
		{
			path: 'src/widget.unit.test.ts',
			kind: 'modified',
			diff: '@@ -1,3 +1,3 @@\n-import { widget } from "./old";\n+import { widget } from "./new";\nMODIFIED-DIFF-SENTINEL',
		},
	];

	return { planContent, checkpoint: 'verify-implement', acceptanceTests: [], changedFiles, changes };
};

test('buildTestChangeReviewInvocation: an empty acceptance mapping still emits the section, saying the run names none', () => {
	const params = setupReviewWithoutRows();

	const { prompt } = buildTestChangeReviewInvocation(params);

	const rowSection = prompt.slice(prompt.indexOf('# Acceptance tests'));
	const rowSectionBody = rowSection.slice(0, rowSection.indexOf('\n\n#') === -1 ? rowSection.length : rowSection.indexOf('\n\n#'));
	expect({
		// the reviewer is told the mapping is empty rather than left to read a
		// heading with nothing under it and guess whether a row was dropped
		sectionEmitted: headingsOf(prompt).includes('# Acceptance tests'),
		saysTheRunNamesNone: /names none/i.test(rowSectionBody),
		// nothing is listed, because there is nothing to list
		bulletsUnderTheSection: rowSectionBody.split('\n').filter((line) => line.startsWith('- ')),
		// and the rest of the evidence still stands
		checkpoint: prompt.includes('verify-implement'),
		changedSourceFile: prompt.includes('src/widgetSource.ts'),
		bundlePath: prompt.includes('src/widget.unit.test.ts'),
		bundleDiff: prompt.includes('MODIFIED-DIFF-SENTINEL'),
	}).toEqual({
		sectionEmitted: true,
		saysTheRunNamesNone: true,
		bulletsUnderTheSection: [],
		checkpoint: true,
		changedSourceFile: true,
		bundlePath: true,
		bundleDiff: true,
	});
});

test('buildTestChangeReviewInvocation: an empty mapping keeps the section order and the closing report reminder', () => {
	const params = setupReviewWithoutRows();

	const { systemPrompt, prompt } = buildTestChangeReviewInvocation(params);

	expect({
		// checkpoint, then the mapping, then the changed source files, then the
		// bundle — the order the reviewer reads its evidence in
		checkpointBeforeTheMapping: prompt.indexOf('# Verification checkpoint') < prompt.indexOf('# Acceptance tests'),
		mappingBeforeTheChangedFiles: prompt.indexOf('# Acceptance tests') < prompt.indexOf('# Changed source files'),
		changedFilesBeforeTheBundle: prompt.indexOf('# Changed source files') < prompt.indexOf('# Changed test-side files'),
		// with no overview, the system prompt is the role prompt and the plan
		roleLeadsTheSystemPrompt: systemPrompt.startsWith('# Role: '),
		planInSystemPrompt: systemPrompt.includes('PLAN-SENTINEL'),
	}).toEqual({
		checkpointBeforeTheMapping: true,
		mappingBeforeTheChangedFiles: true,
		changedFilesBeforeTheBundle: true,
		roleLeadsTheSystemPrompt: true,
		planInSystemPrompt: true,
	});
	// the report-contract reminder still closes the prompt
	expect(prompt.trimEnd()).toMatch(/one JSON[^\n]*object[^\n]*$/);
});
