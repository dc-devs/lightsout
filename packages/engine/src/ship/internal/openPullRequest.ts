import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import { PullRequestState } from '#src/ship/forge/common/constants/PullRequestState.ts';
import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';
import { createPullRequest } from '#src/ship/forge/createPullRequest.ts';
import { findPullRequest } from '#src/ship/forge/findPullRequest.ts';
import { renderPullRequestBody } from '#src/ship/internal/renderPullRequestBody.ts';

interface Params {
	branch: string;
	cwd: string;
	settings: ShipSettings;
	/** The branch's ticket capture groups, which the body template's tokens are substituted from. */
	ticket: Record<string, string>;
	onProgress?: (message: string) => void;
}

/**
 * The branch's pull request: the open one when there is one, else a new one
 * carrying the rendered body.
 *
 * Adoption is resume, not re-render — a body someone has since edited by hand
 * is theirs, and a re-run must not overwrite it. That is also what makes a
 * second shipping attempt cheap: the pull request the first one opened is the
 * one the second one waits on.
 */
export const openPullRequest = async ({ branch, cwd, settings, ticket, onProgress }: Params): Promise<PullRequestSummary | ShipStepFailure> => {
	const adopted = await findPullRequest({ branch, cwd, state: PullRequestState.Open });

	if (adopted !== undefined) {
		onProgress?.(`pull request #${adopted.number} is already open — adopting it`);

		return adopted;
	}

	const body = renderPullRequestBody({ template: settings.pullRequestBody, tokens: { ...ticket, branch } });
	const created = await createPullRequest({ branch, body, cwd });

	onProgress?.('stderr' in created ? 'the forge would not open a pull request' : `opened pull request #${created.number}`);

	return created;
};
