import { messageOf } from '#src/common/utils/messageOf.ts';
import type { JiraQueueSettings } from '#src/queue/common/types/JiraQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';

interface Params<Result> {
	settings: JiraQueueSettings;
	request: (client: JiraClient) => Promise<Result>;
}

interface JsonRequestParams {
	method: 'GET' | 'POST' | 'PUT';
	path: string;
	body?: unknown;
	response: typeof ResponseKind.Json;
}

interface EmptyRequestParams {
	method: 'GET' | 'POST' | 'PUT';
	path: string;
	body?: unknown;
	response: typeof ResponseKind.Empty;
}

interface JiraClient {
	request<Result>(params: JsonRequestParams): Promise<Result>;
	request(params: EmptyRequestParams): Promise<void>;
}

const ResponseKind = { Json: 'json', Empty: 'empty' } as const;

const createJiraClient = ({ settings }: { settings: JiraQueueSettings }): JiraClient => {
	function request<Result>(params: JsonRequestParams): Promise<Result>;
	function request(params: EmptyRequestParams): Promise<void>;
	async function request({ method, path, body, response }: JsonRequestParams | EmptyRequestParams) {
		const authorization = Buffer.from(`${settings.apiUserEmail}:${settings.apiKey}`).toString('base64');
		const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Basic ${authorization}` };
		if (body !== undefined) {
			headers['Content-Type'] = 'application/json';
		}

		const responseValue = await fetch(`${settings.siteUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
		const text = await responseValue.text();

		if (!responseValue.ok) {
			throw new Error(`Jira request failed with ${responseValue.status}: ${text || responseValue.statusText}`);
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
			const parsed: unknown = JSON.parse(text);
			return parsed;
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

export const runJira = async <Result>({ settings, request }: Params<Result>): Promise<Result | QueueFailure> => {
	try {
		return await withDeadline({ request: request(createJiraClient({ settings })) });
	} catch (error) {
		return { error: messageOf({ error }) };
	}
};
