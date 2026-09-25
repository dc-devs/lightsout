/** A coverage scope's Jest configuration as loaded from disk, before any view parses the keys it needs. */
export interface LoadedJestConfig {
	/** Absolute path of the configuration file the scope's coverage command runs — a package.json when the configuration rides under its `jest` key. Views resolve relative settings against this file's directory, exactly as Jest does. */
	configPath: string;
	/** The configuration object as loaded, unvalidated: each view runs its own loose parse over the keys it reads, so a key one view does not recognise never blocks the other. */
	config: object;
}
