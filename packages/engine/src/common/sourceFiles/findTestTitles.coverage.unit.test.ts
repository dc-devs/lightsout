import { describe, expect, test } from '@jest/globals';
import { findTestTitles } from '#src/common/sourceFiles/findTestTitles.ts';

/**
 * Sources whose punctuation, rather than their words, decides where a title
 * starts and ends: an escape, a bracketed table carrying its own quotes, and
 * two spans a file never closes.
 */
const setupSources = () => {
	/** A title escaping a quote of its own kind — the escaped quote must not end the title. */
	const escapedQuote = "test('it\\'s green, every bit of it', () => {});";

	/** An each table holding a string whose characters would otherwise close the table early. */
	const bracketedTable = "test.each([{ label: 'a)(', n: 1 }])('handles %s brackets', () => {});";

	/** A title whose quote is never closed, followed by a head the reader must still reach. */
	const unclosedTitle = ["test('never closed", 'it("the next readable title", () => {});'].join('\n');

	/** An each table whose bracket is never closed, followed by a head the reader must still reach. */
	const unclosedTable = ['test.each([{ n: 1 },', 'it("a readable title after it", () => {});'].join('\n');

	/** A tagged-template table whose own text carries a dollar that opens no substitution. */
	const dollarInTable = ['test.each`', '\tcost$', '\t${5}', "`('costs $cost dollars', () => {});"].join('\n');

	/** A head naming `.each` with no table after it at all — prose about the runner, not a case. */
	const eachWithoutTable = ['// test.each expands one case per table row', "test('the only real head', () => {});"].join('\n');

	/** The words `it` and `test` used as ordinary identifiers, so neither is followed by a call at all. */
	const headWordsThatCallNothing = [
		'const it = getIterator();',
		'it.next();',
		'let test = null;',
		'test = buildCase();',
		"test('the only real head', () => {});",
	].join('\n');

	/** A file that stops immediately after a head's opening parenthesis. */
	const truncatedHead = ["test('the readable one', () => {});", 'test('].join('\n');

	return { escapedQuote, bracketedTable, unclosedTitle, unclosedTable, dollarInTable, eachWithoutTable, headWordsThatCallNothing, truncatedHead };
};

describe('findTestTitles', () => {
	test('reads a title through an escaped quote of its own kind', () => {
		const { escapedQuote } = setupSources();

		const titles = findTestTitles({ content: escapedQuote });

		// the title comes back as the file writes it, escape included — the whole
		// title, not the half that sits before the escaped quote
		expect(titles).toStrictEqual(["it\\'s green, every bit of it"]);
	});

	test('reads past an each table whose own strings hold brackets', () => {
		const { bracketedTable } = setupSources();

		const titles = findTestTitles({ content: bracketedTable });

		// the ')' inside the table's string is text, so the title is the literal
		// after the table rather than something inside it
		expect(titles).toStrictEqual(['handles %s brackets']);
	});

	test('reports nothing for a title the file never closes, and keeps reading after it', () => {
		const { unclosedTitle } = setupSources();

		const titles = findTestTitles({ content: unclosedTitle });

		expect(titles).toStrictEqual(['the next readable title']);
	});

	test('reports nothing for an each table the file never closes, and keeps reading after it', () => {
		const { unclosedTable } = setupSources();

		const titles = findTestTitles({ content: unclosedTable });

		expect(titles).toStrictEqual(['a readable title after it']);
	});

	test('reads past a tagged-template table holding a dollar that opens no substitution', () => {
		const { dollarInTable } = setupSources();

		const titles = findTestTitles({ content: dollarInTable });

		// only `${` opens a substitution, so a lone dollar in the table is text and
		// the template still ends where the file ends it
		expect(titles).toStrictEqual(['costs $cost dollars']);
	});

	test('reports nothing for an each head with no table after it', () => {
		const { eachWithoutTable } = setupSources();

		const titles = findTestTitles({ content: eachWithoutTable });

		expect(titles).toStrictEqual(['the only real head']);
	});

	test('reports nothing for a head word that calls nothing', () => {
		const { headWordsThatCallNothing } = setupSources();

		const titles = findTestTitles({ content: headWordsThatCallNothing });

		// `it` and `test` are ordinary words a file may use as a name; only the one
		// that opens a call with a quoted first argument states a title
		expect(titles).toStrictEqual(['the only real head']);
	});

	test('reports nothing for a head whose call the file ends inside', () => {
		const { truncatedHead } = setupSources();

		const titles = findTestTitles({ content: truncatedHead });

		// a half-written file — mid-edit, or truncated — answers with the titles it
		// did state rather than throwing at the end of its own text
		expect(titles).toStrictEqual(['the readable one']);
	});
});
