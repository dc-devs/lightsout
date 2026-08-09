interface Params {
	invoices: Array<{ dueOn: string; paid: boolean }>;
	today: string;
}

export const countOverdue = ({ invoices, today }: Params): number => {
	return invoices.filter((invoice) => !invoice.paid && invoice.dueOn < today).length;
};
