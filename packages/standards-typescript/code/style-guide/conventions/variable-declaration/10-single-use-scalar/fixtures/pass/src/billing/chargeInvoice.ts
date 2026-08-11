export const chargeInvoice = ({ attempt }: { attempt: number }): boolean => {
	const maxRetries = 10;

	return attempt < maxRetries;
};
