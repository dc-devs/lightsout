interface Params {
	amounts: number[];
}

// This export was touched — a currency was added to the result — and its return
// type was dropped rather than updated, which is the one move the rule forbids.
export const getInvoiceTotal = ({ amounts }: Params) => ({
	total: amounts.reduce((sum, amount) => sum + amount, 0),
	currency: 'usd',
});
