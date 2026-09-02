interface Params {
	value: string;
}

export const quoteJqlString = ({ value }: Params): string => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
