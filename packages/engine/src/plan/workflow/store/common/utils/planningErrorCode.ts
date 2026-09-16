interface Params {
	error: unknown;
}

/** Node filesystem errors can cross VM realms; inspect their structured code rather than Error identity. */
export const planningErrorCode = ({ error }: Params): string | undefined =>
	typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
