import { planWorkspacePath } from '#src/plan/index.ts';

interface Params {
	/** The new plan's address. */
	address: string;
	/** The new plan's id, as the sentences name it. */
	planId: string;
	/** Whether the source held a plan deliverable, which is what there is to publish. */
	hasDeliverable: boolean;
	/** Whether any of the source's runs did not pass, which is what there is to resume. */
	hasUnfinishedRun: boolean;
	/** The move's own sentence, when the files could not all be taken. */
	moveError?: string;
	/** The rewrite's own sentence, when a moved record could not be pointed at the plan. */
	rewriteError?: string;
}

/**
 * What a `--from` add still has to tell the human, as sentences rather than one
 * joined string, so the caller can put its own sentence in front of them without
 * a second joining rule.
 */
export const describeLooseFileNotice = ({ address, planId, hasDeliverable, hasUnfinishedRun, moveError, rewriteError }: Params): string[] => [
	...(hasDeliverable
		? [`the files moved into plan ${planId} are not published under its own titles yet — run \`lightsout plan publish --name ${address}\`.`]
		: []),
	...(hasUnfinishedRun
		? [
				`the source folder's earlier runs can no longer be resumed through their old plan path now that its files have moved — finish plan ${planId}'s implementation with \`lightsout implement --plan ${planWorkspacePath({ name: address })}\`.`,
			]
		: []),
	...(moveError === undefined ? [] : [moveError]),
	...(rewriteError === undefined ? [] : [rewriteError]),
];
