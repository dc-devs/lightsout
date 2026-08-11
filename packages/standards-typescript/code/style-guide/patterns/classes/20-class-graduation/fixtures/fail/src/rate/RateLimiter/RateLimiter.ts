interface ConstructorParams {
	tokens: number;
}

// A folder and a barrel around a class that bundles nothing — ceremony, not
// structure. `RateLimiter.ts` beside its test is the whole module.
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
