/** One pull request, as much of it as the ship result and the merge step need. */
export interface PullRequestSummary {
	number: number;
	url: string;
	title: string;
	/** Head branch as the forge records it. */
	branch: string;
}
