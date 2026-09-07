import { expect, test } from '@jest/globals';
import { buildTestChangeReviewInvocation } from '#src/agents/index.ts';

/** Every markdown heading line in a prompt — one per section the builder actually emitted. */
const headingsOf = (text: string): string[] => text.split('\n').filter((line) => /^#{1,6} /.test(line));

/**
 * One checkpoint's review: two acceptance rows in two files, two changed source
 * files, and a bundle holding a modified test file and an added one. Every
 * fixture is sentinel-marked and carries no heading of its own, so a section the
 * builder drops shows up as a heading that disappeared rather than as fixture
 * text that moved.
 */
const setupReview = () => {
	const planContent = 'Plan: replace the whole-file lock with a reviewed baseline. PLAN-SENTINEL';
	const overviewContent = 'Overview: the same effort, across three phases. OVERVIEW-SENTINEL';
	const acceptanceTests = [
		{ criterion: 'a disabled widget renders nothing', testFile: 'src/widget.unit.test.ts', testName: 'widget: disabled renders nothing' },
		{ criterion: 'an enabled label renders its text', testFile: 'src/label.unit.test.ts', testName: 'label: enabled renders its text' },
	];
	const changedFiles = ['src/widgetSource.ts', 'src/labelSource.ts'];
	const changes = [
		{
			path: 'src/widget.unit.test.ts',
			kind: 'modified',
			diff: '@@ -1,3 +1,3 @@\n-import { widget } from "./old";\n+import { widget } from "./new";\nMODIFIED-DIFF-SENTINEL',
		},
		{ path: 'src/label.unit.test.ts', kind: 'added', diff: '@@ -0,0 +1,2 @@\n+test("label: enabled renders its text", () => {});\nADDED-DIFF-SENTINEL' },
	];

	return { planContent, overviewContent, checkpoint: 'verify-implement', acceptanceTests, changedFiles, changes };
};

test('buildTestChangeReviewInvocation: the system prompt carries role, overview and plan, and none of it reaches the user prompt', () => {
	const params = setupReview();

	const { systemPrompt, prompt } = buildTestChangeReviewInvocation(params);

	const roleSection = systemPrompt.slice(0, systemPrompt.indexOf('OVERVIEW-SENTINEL'));
	expect({
		leadsWithTheRolePrompt: systemPrompt.startsWith('# Role: '),
		roleStatesApprove: /approve/i.test(roleSection),
		roleStatesReject: /reject/i.test(roleSection),
		overviewInSystemPrompt: systemPrompt.includes('OVERVIEW-SENTINEL'),
		planInSystemPrompt: systemPrompt.includes('PLAN-SENTINEL'),
		overviewComesBeforeThePlan: systemPrompt.indexOf('OVERVIEW-SENTINEL') < systemPrompt.indexOf('PLAN-SENTINEL'),
		roleInUserPrompt: prompt.startsWith('# Role: '),
		overviewInUserPrompt: prompt.includes('OVERVIEW-SENTINEL'),
		planInUserPrompt: prompt.includes('PLAN-SENTINEL'),
	}).toEqual({
		leadsWithTheRolePrompt: true,
		roleStatesApprove: true,
		roleStatesReject: true,
		overviewInSystemPrompt: true,
		planInSystemPrompt: true,
		overviewComesBeforeThePlan: true,
		// the run-stable context is paid for once, in the cached system prompt
		roleInUserPrompt: false,
		overviewInUserPrompt: false,
		planInUserPrompt: false,
	});
});

test('buildTestChangeReviewInvocation: the user prompt carries the checkpoint, the rows, the changed files and every diff', () => {
	const params = setupReview();

	const { prompt } = buildTestChangeReviewInvocation(params);

	expect({
		checkpoint: prompt.includes('verify-implement'),
		firstRowFile: prompt.includes('src/widget.unit.test.ts'),
		firstRowName: prompt.includes('widget: disabled renders nothing'),
		firstRowCriterion: prompt.includes('a disabled widget renders nothing'),
		secondRowFile: prompt.includes('src/label.unit.test.ts'),
		secondRowName: prompt.includes('label: enabled renders its text'),
		secondRowCriterion: prompt.includes('an enabled label renders its text'),
		firstChangedFile: prompt.includes('src/widgetSource.ts'),
		secondChangedFile: prompt.includes('src/labelSource.ts'),
		modifiedKind: prompt.includes('modified'),
		modifiedDiff: prompt.includes(params.changes[0].diff),
		addedKind: prompt.includes('added'),
		addedDiff: prompt.includes(params.changes[1].diff),
		diffsAreFenced: prompt.includes('```'),
	}).toEqual({
		checkpoint: true,
		firstRowFile: true,
		firstRowName: true,
		firstRowCriterion: true,
		secondRowFile: true,
		secondRowName: true,
		secondRowCriterion: true,
		firstChangedFile: true,
		secondChangedFile: true,
		modifiedKind: true,
		modifiedDiff: true,
		addedKind: true,
		addedDiff: true,
		diffsAreFenced: true,
	});
	// the report-contract reminder closes the prompt
	expect(prompt.trimEnd()).toMatch(/one JSON[^\n]*object[^\n]*$/);
});

test('buildTestChangeReviewInvocation: absent optional inputs emit no section rather than an empty one', () => {
	const params = setupReview();

	const full = buildTestChangeReviewInvocation(params);
	const bare = buildTestChangeReviewInvocation({ ...params, overviewContent: undefined, changedFiles: [] });

	const droppedSystemHeadings = headingsOf(full.systemPrompt).filter((heading) => !headingsOf(bare.systemPrompt).includes(heading));
	const droppedUserHeadings = headingsOf(full.prompt).filter((heading) => !headingsOf(bare.prompt).includes(heading));
	expect({
		overviewText: bare.systemPrompt.includes('OVERVIEW-SENTINEL'),
		changedFileText: bare.prompt.includes('src/widgetSource.ts'),
		// a whole heading disappeared with each absent input, so the section was
		// omitted rather than emitted with nothing under it
		systemSectionDropped: droppedSystemHeadings.length > 0,
		userSectionDropped: droppedUserHeadings.length > 0,
		// and nothing new appeared in its place
		systemHeadingsAreASubset: headingsOf(bare.systemPrompt).every((heading) => headingsOf(full.systemPrompt).includes(heading)),
		userHeadingsAreASubset: headingsOf(bare.prompt).every((heading) => headingsOf(full.prompt).includes(heading)),
		// the sections that do not depend on an optional input still stand
		checkpoint: bare.prompt.includes('verify-implement'),
		bundle: bare.prompt.includes('MODIFIED-DIFF-SENTINEL'),
		plan: bare.systemPrompt.includes('PLAN-SENTINEL'),
	}).toEqual({
		overviewText: false,
		changedFileText: false,
		systemSectionDropped: true,
		userSectionDropped: true,
		systemHeadingsAreASubset: true,
		userHeadingsAreASubset: true,
		checkpoint: true,
		bundle: true,
		plan: true,
	});
});
