import { expect, test } from '@jest/globals';
import { holdsTestTitle } from '#src/common/sourceFiles/holdsTestTitle.ts';

const setupSources = () => {
	/** A plain literal title, the shape a ledger row normally names. */
	const literalHead = [
		"import { expect, test } from '@jest/globals';",
		'',
		"test('renders 3 rows', () => {",
		'\texpect(render()).toHaveLength(3);',
		'});',
	].join('\n');

	/** The same behaviour written as a parameterised head, title and all. */
	const eachHead = [
		"import { expect, test } from '@jest/globals';",
		'',
		"test.each([{ rows: 3 }, { rows: 4 }])('renders %d rows', ({ rows }) => {",
		'\texpect(render()).toHaveLength(rows);',
		'});',
	].join('\n');

	/**
	 * Every place a name can appear without heading a test call: a comment, a
	 * describe block, and a variable passed as the title. The one real head is
	 * the control — it proves a false answer below is a refusal, not an empty
	 * fixture.
	 */
	const prose = [
		"import { describe, expect, test } from '@jest/globals';",
		'',
		'// keeps the row count in sync',
		"const title = 'names the row count';",
		'',
		"describe('counts the rows', () => {",
		'\ttest(title, () => {',
		'\t\texpect(render()).toHaveLength(3);',
		'\t});',
		'',
		"\ttest('states its own title', () => {",
		'\t\texpect(render()).toHaveLength(3);',
		'\t});',
		'});',
	].join('\n');

	return { literalHead, eachHead, prose };
};

test('holdsTestTitle: matches an exact title and a parameterised title through its placeholders', () => {
	const { literalHead, eachHead } = setupSources();

	const exact = holdsTestTitle({ content: literalHead, testName: 'renders 3 rows' });
	const template = holdsTestTitle({ content: eachHead, testName: 'renders %d rows' });
	const throughPlaceholder = holdsTestTitle({ content: literalHead, testName: 'renders %d rows' });
	const differentTitle = holdsTestTitle({ content: literalHead, testName: 'renders 4 rows' });
	const unanchored = holdsTestTitle({ content: literalHead, testName: 'the table renders %d rows' });

	expect({ exact, template, throughPlaceholder, differentTitle, unanchored }).toEqual({
		exact: true,
		template: true,
		throughPlaceholder: true,
		differentTitle: false,
		unanchored: false,
	});
});

test('holdsTestTitle: refuses a name that appears in the file but heads no test call', () => {
	const { prose } = setupSources();

	const inComment = holdsTestTitle({ content: prose, testName: 'keeps the row count in sync' });
	const inDescribe = holdsTestTitle({ content: prose, testName: 'counts the rows' });
	const inVariable = holdsTestTitle({ content: prose, testName: 'names the row count' });
	const headsATestCall = holdsTestTitle({ content: prose, testName: 'states its own title' });

	expect({ inComment, inDescribe, inVariable, headsATestCall }).toEqual({
		inComment: false,
		inDescribe: false,
		inVariable: false,
		headsATestCall: true,
	});
});
