interface ConstructorParams {
	/** The pack name the URL carried. */
	name: string;
}

/**
 * No pack this repo loads answers to the name a URL carried. Not a bug and not a
 * missing file — the name itself is the mistake, which is why a server function
 * turns this into a 404 rather than a 500.
 */
export class StandardsPackNotFoundError extends Error {
	constructor({ name }: ConstructorParams) {
		super(`no standards pack this repo loads is named "${name}"`);
		this.name = 'StandardsPackNotFoundError';
	}
}
