interface ConstructorParams {
	tokens: number;
}

// Criterion (a): the remaining tokens persist across calls, so "how many rate
// limiters exist right now?" is a question with a meaningful answer.
export class RateLimiter {
	private remaining: number;

	constructor({ tokens }: ConstructorParams) {
		this.remaining = tokens;
	}

	take(): boolean {
		const allowed = this.remaining > 0;

		if (allowed) {
			this.remaining -= 1;
		}

		return allowed;
	}

	refill({ tokens }: { tokens: number }): void {
		this.remaining = tokens;
	}
}
