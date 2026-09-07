/**
 * The placeholders a parameterised test name carries: printf conversions jest
 * substitutes positionally, and `$name` property references it substitutes by
 * key.
 */
const placeholder = /%[sdifjop#%]|\$[A-Za-z_$][\w$]*(?:\.[\w$]+)*/g;

const escapeLiteral = ({ text }: { text: string }) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Params {
	/** The name a ledger row (or an acceptance-test record) carries. */
	testName: string;
	/** A title as a file states it, or as the runner reported it. */
	title: string;
}

/**
 * Whether a title is the test a ledger name means — the one rule the static
 * locator and the execution check share, so the two can never disagree about
 * what a row names.
 *
 * A name carrying no placeholder is literal: it matches a title equal to it and
 * nothing else, its regex-special characters included. A name carrying a
 * placeholder is a template — the head of a `.each` — and matches the template
 * as a file states it, or any title it could have produced, every placeholder
 * read as a wildcard and every other character literal, anchored at both ends.
 *
 * Whether a name is a template is decided by the name alone, so one call answers
 * for a file's static title and for the runner's substituted one.
 */
export const matchesTestTitle = ({ testName, title }: Params): boolean => {
	if (title === testName) {
		return true;
	}

	const literalParts = testName.split(placeholder);

	return literalParts.length > 1 && new RegExp(`^${literalParts.map((part) => escapeLiteral({ text: part })).join('.*')}$`).test(title);
};
