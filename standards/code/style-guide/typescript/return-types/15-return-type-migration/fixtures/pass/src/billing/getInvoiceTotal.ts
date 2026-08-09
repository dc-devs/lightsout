interface Params {
	amounts: number[];
}

// Touched, so it gained the annotation the new shape owes its consumers.
export const getInvoiceTotal = ({ amounts }: Params): { total: number; currency: string } => ({
	total: amounts.reduce((sum, amount) => sum + amount, 0),
	currency: 'usd',
});
