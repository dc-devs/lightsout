interface Config {
	name: string;
}

// "Both config functions" is the rationalization the rule names and rejects.
export const loadConfig = ({ path }: { path: string }): Config => ({ name: path });

export const saveConfig = ({ path, config }: { path: string; config: Config }): string => `${path}:${config.name}`;
