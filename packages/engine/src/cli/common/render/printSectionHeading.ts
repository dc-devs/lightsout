import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';

interface Params {
	/** What the section is, e.g. `Code checks`. */
	title: string;
	/** How it answers — the one thing a reader needs to know to read what follows. */
	subtitle: string;
}

/**
 * A section heading: bold title, dim subtitle, a blank line above so it reads
 * as a break. Everything a section prints sits under it, indented.
 */
export const printSectionHeading = ({ title, subtitle }: Params): void => {
	console.log('');
	console.log(`${bold(title)}  ${dim('·')}  ${dim(subtitle)}`);
};
