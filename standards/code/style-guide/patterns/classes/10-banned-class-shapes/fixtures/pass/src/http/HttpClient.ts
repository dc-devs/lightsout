interface ConstructorParams {
	baseUrl: string;
	retries?: number;
}

// Criteria (a) and (b) together: injected configuration every method reads, and
// a retry budget that changes as calls are made.
export class HttpClient {
	private readonly baseUrl: string;

	private remaining: number;

	constructor({ baseUrl, retries = 3 }: ConstructorParams) {
		this.baseUrl = baseUrl;
		this.remaining = retries;
	}

	get({ path }: { path: string }): string {
		this.remaining -= 1;

		return `GET ${this.baseUrl}${path}`;
	}

	post({ path }: { path: string }): string {
		this.remaining -= 1;

		return `POST ${this.baseUrl}${path}`;
	}

	getRemainingRetries(): number {
		return this.remaining;
	}
}
