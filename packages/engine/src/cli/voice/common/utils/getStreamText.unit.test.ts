import { Readable } from 'node:stream';
import { describe, expect, test } from '@jest/globals';
import { getStreamText } from '@/cli/voice/common/utils/getStreamText';

describe('getStreamText', () => {
	test('joins the pieces a payload arrives in back into one string', async () => {
		const text = await getStreamText({ stream: Readable.from(['{"a":', '1}']) });

		expect(text).toBe('{"a":1}');
	});

	test('reads raw bytes as text', async () => {
		const text = await getStreamText({ stream: Readable.from([Buffer.from('{"a":1}')]) });

		expect(text).toBe('{"a":1}');
	});

	test('a stream that carries nothing reads as empty', async () => {
		const text = await getStreamText({ stream: Readable.from([]) });

		expect(text).toBe('');
	});
});
