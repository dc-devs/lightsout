import type { SourceEvidenceEntry } from '#src/contracts/plan/evidence/SourceEvidenceEntry.ts';
import type { SourceEvidenceIndex } from '#src/contracts/plan/evidence/SourceEvidenceIndex.ts';
import { SourceEvidenceKind } from '#src/contracts/plan/evidence/SourceEvidenceKind.ts';
import { wholeFileEvidenceLimit } from '#src/plan/evidence/internal/common/constants/wholeFileEvidenceLimit.ts';

interface Params {
	index: SourceEvidenceIndex;
	/** Repo-relative paths this assignment needs, in the order they should appear. */
	paths: string[];
}

/**
 * A fence long enough that the evidence inside it cannot end its own block. A
 * three-backtick wrapper around a file whose docblock holds a fenced example
 * would close at the docblock and spill the rest of the file into the prompt as
 * instructions to the writer.
 */
const fenceFor = ({ text }: { text: string }) => {
	const longestRun = [...text.matchAll(/`+/g)].reduce((longest, match) => Math.max(longest, match[0].length), 0);

	return '`'.repeat(Math.max(3, longestRun + 1));
};

/** The evidence text in a block it cannot break out of, always ending with its own newline. */
const fenced = ({ text }: { text: string }) => {
	const fence = fenceFor({ text });

	return `${fence}\n${text.endsWith('\n') ? text : `${text}\n`}${fence}`;
};

/** Why the facts named this file, in their own words — a block that drops them hands over source with no reason to read it. */
const roleLines = ({ roles }: { roles: string[] }) => (roles.length === 0 ? ['The facts recorded no role for this file.'] : roles.map((role) => `- ${role}`));

/** One requested path's block: what was collected for it, and what the writer must not read into what is absent. */
const renderBlock = ({ path, entry }: { path: string; entry: SourceEvidenceEntry | undefined }) => {
	const lines = [`### \`${path}\``, ''];

	if (entry === undefined) {
		lines.push('No evidence was collected for this path. Open the file yourself for anything you need from it.');
	} else {
		lines.push(...roleLines({ roles: entry.roles }), '');

		if (entry.kind === SourceEvidenceKind.Missing) {
			lines.push('The facts named this path and nothing was on disk at it when the evidence was collected.');
		} else {
			if (entry.kind === SourceEvidenceKind.Definitions) {
				lines.push(
					`This file is ${entry.bytes} bytes, past the ${wholeFileEvidenceLimit.toLocaleString('en-US')}-byte whole-file limit, so only these definitions are shown: ${entry.definitions.join(', ')}. Everything else the file holds is still there — open it for anything the definitions below do not answer.`,
					'',
				);
			}

			lines.push(fenced({ text: entry.text }));
		}
	}

	return lines.join('\n');
};

/**
 * Render the collected evidence for one assignment as the Markdown section a
 * plan writer reads — heading line included, no trailing newline, because the
 * caller owns how the section joins the text around it.
 *
 * Selection lives here rather than in the caller so that "which evidence did
 * this writer get" is one testable function. A writer receives the evidence for
 * the files its own work touches and never the union of every phase's, which is
 * the whole point of assembling per assignment.
 *
 * Three absences are stated differently on purpose. A reduced file says the
 * limit it passed, names what survived, and says the rest is one read away, so
 * an absence in the brief is never read as an absence in the file. A file the
 * facts named and disk does not hold is a fact about the repository the writer
 * has to plan around. A path nothing was collected for is a fact about this
 * record, which the writer answers by opening the file.
 *
 * An empty `paths` list renders the empty string: an empty section heading in a
 * prompt reads as "there is no evidence for any of this", which is a different
 * claim from "this spawn needs none".
 */
export const renderEvidenceBrief = ({ index, paths }: Params): string => {
	if (paths.length === 0) {
		return '';
	}

	const byPath = new Map(index.entries.map((entry) => [entry.path, entry]));
	const preamble = [
		'## Source Evidence',
		'',
		'The engine read these files once for this draft, from the paths the verified facts recorded. Start here rather than re-reading them. You still have file tools: open anything this section does not answer, and stop the draft rather than guessing when what you find and what the facts say cannot be reconciled.',
	];
	const blocks = paths.map((path) => renderBlock({ path, entry: byPath.get(path) }));

	return [...preamble, '', blocks.join('\n\n')].join('\n');
};
