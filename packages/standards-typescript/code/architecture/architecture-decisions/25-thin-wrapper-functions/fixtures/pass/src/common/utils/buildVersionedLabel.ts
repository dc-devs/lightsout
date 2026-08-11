interface Params {
	name: string;
	version: string;
}

export const buildVersionedLabel = ({ name, version }: Params): string => `${name} ${version}`;
