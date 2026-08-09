interface ConstructorParams {
	perMinute: number;
}

// A folder, a barrel, and nothing private to hide behind them — ceremony for a
// concept that is still one file.
export class RateLimiter {
	private remaining: number;

	constructor({ perMinute }: ConstructorParams) {
		this.remaining = perMinute;
	}

	take(): boolean {
		const allowed = this.remaining > 0;

		if (allowed) {
			this.remaining -= 1;
		}

		return allowed;
	}
}
