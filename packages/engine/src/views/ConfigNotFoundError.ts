interface ConstructorParams {
	/** Absolute path the config was looked for at. */
	configPath: string;
}

/**
 * No `lightsout.config.json` sits above the directory the app was pointed at.
 *
 * Distinct from a config that exists and will not parse: that one has a message
 * a reader can act on and travels to the error boundary as itself, while this is
 * a page about a file that is not there — which is a 404, and what the server
 * function turns it into.
 */
export class ConfigNotFoundError extends Error {
	constructor({ configPath }: ConstructorParams) {
		super(`no lightsout.config.json at ${configPath}`);
		this.name = 'ConfigNotFoundError';
	}
}
