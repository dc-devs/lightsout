import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';

interface Params {
	/** What the section is, e.g. `Code checks`. */
	title: string;
	/** How it answers, when the title alone does not say — dim, beside the title. */
	subtitle?: string;
}

/**
 * A section heading: bold title, optional dim subtitle, a blank line above so
 * it reads as a break. Everything a section prints sits under it, indented.
 */
export const printSectionHeading = ({ title, subtitle }: Params): void => {
	console.log('');
	console.log(subtitle === undefined ? bold(title) : `${bold(title)}  ${dim('·')}  ${dim(subtitle)}`);
};
