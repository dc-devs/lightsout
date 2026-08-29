import type { Issue } from '@linear/sdk';
import { collectNodes } from '#src/queue/tracker/common/utils/collectNodes.ts';

interface Params {
	issue: Issue;
}

/**
 * Workflow-state types that mean a blocker is done with.
 *
 * A canceled blocker counts as finished deliberately: a ticket someone gave up
 * on must not block its dependent forever.
 */
const finishedStateTypes = new Set(['completed', 'canceled']);

/**
 * The identifiers of every blocking ticket this issue is still waiting on.
 *
 * Linear stores "A blocks B" once, on A; from B's side it is an INVERSE
 * relation, so the blockers of an issue are the `issue` (source) side of its
 * inverse relations whose type is 'blocks'.
 *
 * A blocker whose workflow state cannot be read is kept rather than dropped:
 * waiting one extra run is recoverable, shipping a dependent ahead of its
 * blocker is not.
 */
export const getUnfinishedBlockers = async ({ issue }: Params): Promise<string[]> => {
	const relations = await collectNodes({ connection: await issue.inverseRelations() });
	const resolved = await Promise.all(
		relations
			.filter((relation) => relation.type === 'blocks')
			.map(async (relation) => {
				const blocker = await relation.issue;

				if (blocker === undefined) {
					return undefined;
				}

				const state = await blocker.state;

				return state !== undefined && finishedStateTypes.has(state.type) ? undefined : blocker.identifier;
			}),
	);

	return resolved.filter((identifier) => identifier !== undefined);
};
