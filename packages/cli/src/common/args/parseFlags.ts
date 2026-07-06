interface Params {
	args: string[];
}

export const parseFlags = ({ args }: Params): Map<string, string | true> => {
	const flags = new Map<string, string | true>();

	let index = 0;

	while (index < args.length) {
		const key = args[index];

		if (!key?.startsWith('--')) {
			index += 1;
			continue;
		}

		const value = args[index + 1];

		if (value === undefined || value.startsWith('--')) {
			flags.set(key.slice(2), true);
			index += 1;
		} else {
			flags.set(key.slice(2), value);
			index += 2;
		}
	}

	return flags;
};
