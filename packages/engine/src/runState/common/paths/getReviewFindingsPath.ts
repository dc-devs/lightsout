import { join } from 'node:path';

interface Params {
	cwd: string;
}

/** One append-only judgment-review log per consumer repo: `<repo>/.lightsout/review-findings.jsonl`. */
export const getReviewFindingsPath = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'review-findings.jsonl');
};
