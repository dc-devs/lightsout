import { expect, test } from '@jest/globals';
import { matchesTestTitle } from '#src/common/sourceFiles/matchesTestTitle.ts';

test('matchesTestTitle: a literal name matches an equal title and nothing else', () => {
	const exact = matchesTestTitle({ testName: 'adds two numbers', title: 'adds two numbers' });
	const longer = matchesTestTitle({ testName: 'adds two numbers', title: 'adds two numbers quickly' });
	const shorter = matchesTestTitle({ testName: 'adds two numbers', title: 'adds two' });
	const different = matchesTestTitle({ testName: 'adds two numbers', title: 'subtracts two numbers' });
	// a literal name is compared as text, so its regex-special characters are not wildcards
	const specialLiteral = matchesTestTitle({ testName: 'reads a.ts', title: 'reads a.ts' });
	const specialWildcard = matchesTestTitle({ testName: 'reads a.ts', title: 'reads aXts' });

	expect({ exact, longer, shorter, different, specialLiteral, specialWildcard }).toStrictEqual({
		exact: true,
		longer: false,
		shorter: false,
		different: false,
		specialLiteral: true,
		specialWildcard: false,
	});
});

test('matchesTestTitle: a template name matches itself and its substitutions, with every other character literal', () => {
	const template = 'formats %s as $expected for a.ts';

	const itself = matchesTestTitle({ testName: template, title: 'formats %s as $expected for a.ts' });
	const substituted = matchesTestTitle({ testName: template, title: 'formats 100 as $1.00 for a.ts' });
	const otherSubstitution = matchesTestTitle({ testName: template, title: 'formats -50 as -$0.50 for a.ts' });
	// every character outside a placeholder stays literal, dots included
	const literalDot = matchesTestTitle({ testName: template, title: 'formats 100 as $1.00 for aXts' });
	const differentWords = matchesTestTitle({ testName: template, title: 'parses 100 as $1.00 for a.ts' });
	// the printf index and escape placeholders are wildcards too
	const indexed = matchesTestTitle({ testName: 'case %# of %d', title: 'case 3 of 7' });

	expect({ itself, substituted, otherSubstitution, literalDot, differentWords, indexed }).toStrictEqual({
		itself: true,
		substituted: true,
		otherSubstitution: true,
		literalDot: false,
		differentWords: false,
		indexed: true,
	});
});
