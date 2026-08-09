const maxRetries = 10;

export const chargeInvoice = ({ attempt }: { attempt: number }): boolean => attempt < maxRetries;
