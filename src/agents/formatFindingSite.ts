import type { StandardsFinding } from '@/contracts';

interface Params {
	/** One location of a standards finding. */
	file: StandardsFinding['files'][number];
}

/**
 * One finding location as `path[:start[-end]]` — the shared rendering used
 * wherever findings become text for an agent prompt or an escalation message,
 * so the two can never drift apart.
 */
export const formatFindingSite = ({ file }: Params): string =>
	`${file.path}${file.startLine ? `:${file.startLine}${file.endLine && file.endLine !== file.startLine ? `-${file.endLine}` : ''}` : ''}`;
