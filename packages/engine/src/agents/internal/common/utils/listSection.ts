interface Params {
	/** The section's heading text, without the `#`. */
	heading: string;
	/** The sentence that introduces the list. */
	intro: string;
	/** One Markdown bullet per entry. */
	items: string[];
	/** The bullets stating the rules that bind the listed entries. */
	rules: string[];
}

/**
 * A brief section that lists entries and then states the rules binding them.
 *
 * @returns the section, or undefined when there is nothing to list — the section is omitted rather than emitted empty.
 */
export const listSection = ({ heading, intro, items, rules }: Params): string | undefined =>
	items.length === 0 ? undefined : [`# ${heading}`, '', intro, '', ...items, '', ...rules].join('\n');
