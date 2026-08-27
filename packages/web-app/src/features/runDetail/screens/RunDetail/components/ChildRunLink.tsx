import { Link } from '@tanstack/react-router';
import { MetadataTag } from '#src/appUI/index.ts';

interface Props {
	/** The child run's full id; the reader is shown its short form. */
	runId: string;
	/** Render the id as plain mono text instead of a link — the demo frame, whose child runs are in no public listing. Defaults false. */
	linksDisabled?: boolean;
}

/**
 * The way into the run a step handed its work to, named by its short id.
 *
 * Three panels point at the same child run — the phase list, the step's own
 * card, and that step's report — so how much of the id is shown, and the inert
 * form the demo frame needs in place of a link, are decided once here rather
 * than three times.
 */
export const ChildRunLink = ({ runId, linksDisabled = false }: Props) => {
	const shortId = runId.slice(0, 8);

	return linksDisabled ? (
		<MetadataTag>{shortId}</MetadataTag>
	) : (
		<Link to="/repo/runs/$runId" params={{ runId }} className="font-mono text-primary text-xs underline underline-offset-2">
			{shortId}
		</Link>
	);
};
