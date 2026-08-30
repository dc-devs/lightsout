import type { ConfigDocs } from '#src/contracts/index.ts';

interface Params {
	/** The repository's declared documentation surfaces, in the order the config wrote them. */
	docs: ConfigDocs;
}

/**
 * One declared documentation surface as a bullet, for the three invocations that
 * name them — the plan writer's brief, the repairer's brief and the
 * documentation checker's role prompt. Three copies of the rendering would be
 * three chances for one to drift into a shape the others do not use.
 *
 * It renders the bullets alone. Each caller supplies its own heading and prose,
 * because what each agent is asked to DO with the list differs.
 */
export const renderDocsSurfaces = ({ docs }: Params): string => docs.map(({ path, covers }) => `- \`${path}\` — ${covers}`).join('\n');
