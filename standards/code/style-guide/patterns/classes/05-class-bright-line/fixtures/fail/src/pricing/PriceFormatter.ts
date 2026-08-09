interface ConstructorParams {
	locale: string;
}

// None of the four criteria hold: nothing persists between calls, one operation
// uses the injected value, there is no second implementation and no framework
// asked for a class. "How many PriceFormatters exist?" is not a question.
export class PriceFormatter {
	private readonly locale: string;

	constructor({ locale }: ConstructorParams) {
		this.locale = locale;
	}

	format({ amount }: { amount: number }): string {
		return amount.toLocaleString(this.locale);
	}
}
