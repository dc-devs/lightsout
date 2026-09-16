import { z } from 'zod';
import { PlanningRoleResult } from '#src/contracts/index.ts';

const createProtocol = ({ role }: { role: PlanningRoleResult['role'] }) => {
	const schema = z.union(PlanningRoleResult.options.filter((option) => option.shape.role.safeParse(role).success));
	return { schema, jsonSchema: z.toJSONSchema(schema, { io: 'input', reused: 'ref' }) };
};

class PlanningProtocols {
	readonly entries = new Map<PlanningRoleResult['role'], ReturnType<typeof createProtocol>>();
}

const protocols = new PlanningProtocols();

interface Params {
	role: PlanningRoleResult['role'];
}

/** Reuse a role's exact protocol lazily; importing a plan parser must not build every model schema. */
export const getPlanningRoleProtocol = ({ role }: Params): ReturnType<typeof createProtocol> => {
	let protocol = protocols.entries.get(role);
	if (!protocol) {
		protocol = createProtocol({ role });
		protocols.entries.set(role, protocol);
	}
	return protocol;
};
