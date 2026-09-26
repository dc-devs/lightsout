interface Props {
	/** A line of plain text in which backticks mark code, as a rule's summary and a document's title are written. */
	text: string;
}

/**
 * A line cut into its backticked words and the text between them, each part
 * keyed by where it starts in the line. A lone backtick with no partner is kept
 * as text.
 */
const splitOnCode = ({ text }: Props) => [...text.matchAll(/`[^`]+`|[^`]+|`/g)].map((match) => ({ part: match[0], start: match.index }));

/** A line with its backticked words drawn as code rather than as literal backticks. */
export const CodeSpans = ({ text }: Props) =>
	splitOnCode({ text }).map(({ part, start }) =>
		part.length > 1 && part.startsWith('`') && part.endsWith('`') ? (
			<code key={start} className="rounded bg-muted px-1 py-px font-mono text-[0.9em] text-foreground">
				{part.slice(1, -1)}
			</code>
		) : (
			<span key={start}>{part}</span>
		),
	);
