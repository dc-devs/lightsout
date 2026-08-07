interface Params {
	args: string[];
}

/** Tokens parseFlags didn't claim — mirrors its flag/value pairing exactly. */
export const getPositionals = ({ args }: Params): string[] => {
	const positionals: string[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];

		if (token?.startsWith('--')) {
			if (args[index + 1] !== undefined && !args[index + 1]?.startsWith('--')) {
				index += 1;
			}

			continue;
		}

		if (token) {
			positionals.push(token);
		}
	}

	return positionals;
};
