import type { StandardsFinding } from '#src/contracts/index.ts';

interface Params {
	/** One location of a standards finding. */
	file: StandardsFinding['files'][number];
}

/**
 * One finding location as `path[:start[-end]]` — the shared rendering used
 * wherever a finding becomes text: an agent prompt, an escalation message, a
 * terminal table. Everything that names a site says it the same way, so a
 * reader moving between them never has to re-learn the format.
 */
export const formatFindingSite = ({ file }: Params): string =>
	`${file.path}${file.startLine ? `:${file.startLine}${file.endLine && file.endLine !== file.startLine ? `-${file.endLine}` : ''}` : ''}`;
