interface Params {
	/** Whatever was caught — JavaScript allows throwing any value, not just an Error. */
	error: unknown;
}

/**
 * The human-readable message for a caught value.
 *
 * `throw` accepts any value, so a catch block cannot assume it holds an Error:
 * a rejected promise from a library, a thrown string, or a plain object all
 * arrive here. Written once because ten call sites had written it out
 * identically, and ten copies of a narrowing rule are ten chances to get it
 * subtly different — one dropping the message, another stringifying an Error
 * into the useless `[object Object]`.
 */
export const messageOf = ({ error }: Params): string => (error instanceof Error ? error.message : String(error));
