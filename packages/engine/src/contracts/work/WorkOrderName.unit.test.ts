import { describe, expect, test } from '@jest/globals';
import { WorkOrderName } from '#src/contracts/index.ts';

const setupName = ({ words }: { words: unknown }) => {
	const answer: Record<string, unknown> = { words };

	return { answer };
};

describe('WorkOrderName', () => {
	test('WorkOrderName: accepts three and four lowercase hyphen-joined words and refuses two words, five words, uppercase and spaces', () => {
		const accepted = ['work-order-state', 'give-the-name-one'].map((words) => WorkOrderName.parse(setupName({ words }).answer));
		const refused = ['name-one', 'give-the-name-one-author', 'Work-Order-State', 'work order state'].map(
			(words) => WorkOrderName.safeParse(setupName({ words }).answer).success,
		);

		// three and four lowercase words are the two shapes a label is composed from
		expect(accepted).toStrictEqual([{ words: 'work-order-state' }, { words: 'give-the-name-one' }]);
		// two words, five words, an uppercase letter and a space are each refused at
		// the boundary, so an answer the engine cannot turn into a label never
		// reaches the label
		expect(refused).toStrictEqual([false, false, false, false]);
	});
});
