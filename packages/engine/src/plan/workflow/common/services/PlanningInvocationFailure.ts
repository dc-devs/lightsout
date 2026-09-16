interface ConstructorParams {
	message: string;
	externallyBlocked: boolean;
	preserveAttempt?: boolean;
}

/** A preserved provider/environment failure; only a concrete external obstacle parks the workflow. */
export class PlanningInvocationFailure extends Error {
	readonly externallyBlocked: boolean;
	readonly preserveAttempt: boolean;
	constructor({ message, externallyBlocked, preserveAttempt = false }: ConstructorParams) {
		super(message);
		this.name = 'PlanningInvocationFailure';
		this.externallyBlocked = externallyBlocked;
		this.preserveAttempt = preserveAttempt;
	}
}
