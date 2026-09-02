import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runLinear } from '#src/ticketTracker/runLinear.ts';

interface Params {
	settings: TrackerSettings;
	ticketId: string;
	/** The section heading to write under, e.g. '## Decisions'. Created at the end of the body when absent. */
	heading: string;
	/** One line, already formatted — usually a `- ` bullet. */
	line: string;
}

/** How deep a markdown heading line is, or undefined when the line is not a heading. */
const readHeadingLevel = ({ line }: { line: string }) => {
	const hashes = /^(#{1,6})\s/.exec(line)?.[1];

	return hashes === undefined ? undefined : hashes.length;
};

/**
 * The body with `line` as the last line of the named section.
 *
 * With no such heading the section is created at the end of the body. A line
 * already present is left alone, so a re-run never doubles a decision.
 */
const addLineUnderHeading = ({ body, heading, line }: { body: string; heading: string; line: string }) => {
	const lines = body.split('\n');

	if (lines.includes(line)) {
		return body;
	}

	const headingIndex = lines.findIndex((candidate) => candidate.trim() === heading.trim());

	if (headingIndex === -1) {
		return `${body.trimEnd()}\n\n${heading}\n\n${line}\n`.trimStart();
	}

	const level = readHeadingLevel({ line: heading.trim() }) ?? 2;
	const after = lines.slice(headingIndex + 1);
	const nextHeading = after.findIndex((candidate) => (readHeadingLevel({ line: candidate }) ?? 7) <= level);
	const sectionEnd = nextHeading === -1 ? lines.length : headingIndex + 1 + nextHeading;
	// Trailing blank lines belong to the gap before the next heading, not to the
	// section — inserting after them would leave the bullet orphaned below it.
	let insertAt = sectionEnd;

	while (insertAt > headingIndex + 1 && lines[insertAt - 1]?.trim() === '') {
		insertAt -= 1;
	}

	return [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)].join('\n');
};

/**
 * Append one line to a section of the ticket's body, creating the section when
 * the ticket has none.
 *
 * The read and the write share one call, so they cannot end up with different
 * deadlines — a body written back from a read a minute old is a body that
 * silently discards whatever happened in between.
 */
export const appendTicketNote = async ({ settings, ticketId, heading, line }: Params): Promise<TrackerFailure | undefined> => {
	const written = await runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const issue = await client.issue(ticketId);
			const description = addLineUnderHeading({ body: issue.description ?? '', heading, line });

			await client.updateIssue(ticketId, { description });

			return undefined;
		},
	});

	return written;
};
