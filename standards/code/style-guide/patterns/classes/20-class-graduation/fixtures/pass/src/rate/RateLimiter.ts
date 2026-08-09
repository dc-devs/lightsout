interface ConstructorParams {
	tokens: number;
}

// No companions, so no folder: the file is the module and the compiler enforces
// its boundary for free.
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
}
