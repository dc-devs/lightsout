interface ConstructorParams {
	/** The pack that was found. */
	name: string;
	/** The rule id it does not carry. */
	rule: string;
}

/**
 * The pack was found and holds no rule of that id — a renamed rule, or a link
 * kept from an older version of the pack. Named separately from
 * `StandardsPackNotFoundError` so a page can say which half of the address was
 * wrong.
 */
export class StandardsPackRuleNotFoundError extends Error {
	constructor({ name, rule }: ConstructorParams) {
		super(`standards pack "${name}" holds no rule named "${rule}"`);
		this.name = 'StandardsPackRuleNotFoundError';
	}
}
