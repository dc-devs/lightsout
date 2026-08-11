interface ConstructorParams {
	baseUrl: string;
}

// `buildQuery` touches no state — it is on the surface only because it was
// written where the class was, and every consumer now sees it as API.
export class HttpClient {
	private readonly baseUrl: string;

	constructor({ baseUrl }: ConstructorParams) {
		this.baseUrl = baseUrl;
	}

	get({ path, query }: { path: string; query: Record<string, string> }): string {
		return `${this.baseUrl}${path}?${this.buildQuery({ query })}`;
	}

	buildQuery({ query }: { query: Record<string, string> }): string {
		return Object.entries(query)
			.map(([key, value]) => `${key}=${value}`)
			.join('&');
	}
}
