interface Params {
	/** The absolute path of the config the run loaded, or `undefined` when the checkout has none. */
	configPath: string | undefined;
}

/**
 * The one line naming the config file a run read.
 *
 * The file is tracked, so every linked worktree carries its own copy, and a
 * command reads the copy in the checkout it was launched from. A setting edited
 * in one checkout and a run launched from another otherwise looks like the
 * engine ignoring the setting; the path makes the mismatch visible.
 */
export const printConfigSource = ({ configPath }: Params): void => {
	console.log(`  config: ${configPath ?? 'none — this checkout has no lightsout.config.json, so every setting is its default'}`);
};
