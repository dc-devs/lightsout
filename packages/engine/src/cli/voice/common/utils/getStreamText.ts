interface Params {
	stream: NodeJS.ReadableStream;
}

/** Read a stream to its end as UTF-8 text — a hook's payload arrives on stdin, never as an argument. */
export const getStreamText = async ({ stream }: Params): Promise<string> => {
	const chunks: string[] = [];

	for await (const chunk of stream) {
		chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
	}

	return chunks.join('');
};
