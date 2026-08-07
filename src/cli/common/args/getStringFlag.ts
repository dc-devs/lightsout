interface Params {
	flags: Map<string, string | true>;
	name: string;
}

export const getStringFlag = ({ flags, name }: Params): string | undefined => {
	const value = flags.get(name);

	return typeof value === 'string' ? value : undefined;
};
