interface ConstructorParams {
	baseUrl: string;
}

// The stateless half is a co-located helper, so the class surface is only what
// genuinely needs the injected base url.
const buildQuery = ({ query }: { query: Record<string, string> }) =>
	Object.entries(query)
		.map(([key, value]) => `${key}=${value}`)
		.join('&');

export class HttpClient {
	private readonly baseUrl: string;

	constructor({ baseUrl }: ConstructorParams) {
		this.baseUrl = baseUrl;
	}

	get({ path, query }: { path: string; query: Record<string, string> }): string {
		return `${this.baseUrl}${path}?${buildQuery({ query })}`;
	}
}
