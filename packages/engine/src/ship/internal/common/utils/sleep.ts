interface Params {
	ms: number;
}

/** Wait, so a poll loop asks the forge again rather than spinning. */
export const sleep = ({ ms }: Params): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
