import { messageOf } from '#src/common/utils/messageOf.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';

interface Params<Result> {
	settings: JiraTrackerSettings;
	request: (client: JiraClient) => Promise<Result>;
}

type JiraMethod = 'DELETE' | 'GET' | 'POST' | 'PUT';

interface RequestParams {
	method: JiraMethod;
	path: string;
	body?: unknown;
	headers?: Record<string, string>;
}

interface JsonRequestParams extends RequestParams {
	response: typeof ResponseKind.Json;
}

interface EmptyRequestParams extends RequestParams {
	response: typeof ResponseKind.Empty;
}

interface TextRequestParams extends RequestParams {
	response: typeof ResponseKind.Text;
}

export interface JiraClient {
	request<Result>(params: JsonRequestParams): Promise<Result>;
	request(params: EmptyRequestParams): Promise<void>;
	request(params: TextRequestParams): Promise<string>;
}

const ResponseKind = { Json: 'json', Empty: 'empty', Text: 'text' } as const;

const createJiraClient = ({ settings }: { settings: JiraTrackerSettings }): JiraClient => {
	function request<Result>(params: JsonRequestParams): Promise<Result>;
	function request(params: EmptyRequestParams): Promise<void>;
	function request(params: TextRequestParams): Promise<string>;
	async function request({ method, path, body, headers: requestedHeaders, response }: JsonRequestParams | EmptyRequestParams | TextRequestParams) {
		const authorization = Buffer.from(`${settings.apiUserEmail}:${settings.apiKey}`).toString('base64');
		const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Basic ${authorization}`, ...requestedHeaders };
		const isMultipart = body instanceof FormData;

		if (body !== undefined && !isMultipart) {
			headers['Content-Type'] = 'application/json';
		}

		const responseValue = await fetch(`${settings.siteUrl}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : isMultipart ? body : JSON.stringify(body),
		});
		const text = await responseValue.text();

		if (!responseValue.ok) {
			throw new Error(`Jira request failed with ${responseValue.status}: ${text || responseValue.statusText}`);
		}

		if (response === ResponseKind.Text) {
			return text;
		}

		if (response === ResponseKind.Empty) {
			if (responseValue.status !== 204 || text !== '') {
				throw new Error('Jira returned a response body where an empty response was expected');
			}

			return;
		}

		if (text === '') {
			throw new Error('Jira returned an empty JSON response');
		}

		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw new Error('Jira returned malformed JSON');
		}
	}

	return { request };
};

const withDeadline = async <Result>({ request }: { request: Promise<Result> }) => {
	const trackerTimeoutMs = 60_000;
	let timer: NodeJS.Timeout | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`the tracker did not answer within ${trackerTimeoutMs}ms`)), trackerTimeoutMs);
	});

	try {
		return await Promise.race([request, deadline]);
	} finally {
		clearTimeout(timer);
	}
};

export const runJira = async <Result>({ settings, request }: Params<Result>): Promise<Result | TrackerFailure> => {
	try {
		return await withDeadline({ request: request(createJiraClient({ settings })) });
	} catch (error) {
		return { error: messageOf({ error }) };
	}
};
