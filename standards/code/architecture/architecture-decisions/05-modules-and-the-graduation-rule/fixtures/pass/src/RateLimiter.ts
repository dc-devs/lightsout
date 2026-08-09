interface ConstructorParams {
	perMinute: number;
}

// One file until it needs private companions. The compiler already enforces the
// boundary: nothing here is exported but the class itself.
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
