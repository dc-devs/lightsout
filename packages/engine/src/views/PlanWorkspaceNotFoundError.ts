interface ConstructorParams {
	/** The workspace name the URL carried. */
	name: string;
}

/**
 * No folder under `.lightsout/plans/` answers to the name a URL carried. Not a
 * bug and not a missing file — the name itself is the mistake, which is why a
 * server function turns this into a 404 rather than a 500.
 *
 * A name carrying a path separator or `..` gets this too: it addresses nothing
 * inside the plans folder, and saying so is the whole answer.
 */
export class PlanWorkspaceNotFoundError extends Error {
	constructor({ name }: ConstructorParams) {
		super(`no plan workspace named "${name}"`);
		this.name = 'PlanWorkspaceNotFoundError';
	}
}
