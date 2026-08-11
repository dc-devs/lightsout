import { pathFromLine } from '@/plan/common/paths/pathFromLine';

interface Params {
	/** The full markdown text of one plan file. */
	planText: string;
}

/**
 * The repo-relative paths named by the `### <path>` subheadings under a plan's
 * `## Files to Create` section — the single create-path parser shared by the
 * structural lint and prior-art detection so the two never drift. Mirrors the
 * Phase 2 parsing contract: within the `## Files to Create` section (its lines
 * run to the next `##` heading; a `###` subheading stays inside), a `###` line
 * whose first backtick token looks like a path (has a `/` and an extension) is a
 * created file.
 */
export const planCreatePaths = ({ planText }: Params): string[] => {
	const paths: string[] = [];
	let inCreateSection = false;

	for (const line of planText.split('\n')) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);

		if (heading) {
			inCreateSection = heading[1] === 'Files to Create';

			continue;
		}

		if (inCreateSection && /^###\s+/.test(line)) {
			const path = pathFromLine({ line });

			if (path) {
				paths.push(path);
			}
		}
	}

	return paths;
};
