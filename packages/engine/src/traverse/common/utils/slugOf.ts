interface Params {
	key: string;
}

/**
 * An edge key reduced to a filesystem-safe slug — lowercased, non-alphanumeric
 * runs collapsed to single hyphens, leading/trailing hyphens trimmed. Empty
 * input yields `edge`.
 */
export const slugOf = ({ key }: Params): string =>
	key
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || 'edge';
