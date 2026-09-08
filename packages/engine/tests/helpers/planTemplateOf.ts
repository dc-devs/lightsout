import { expectDefined } from '#tests/helpers/expectDefined.ts';

/**
 * The plan template a writer spawn was handed, cut out of its system prompt.
 *
 * The role prompt names several of the template's own headings in its rules, so
 * an assertion about what a template carries has to read the template alone
 * rather than the whole system prompt.
 */
export const planTemplateOf = ({ systemPrompt }: { systemPrompt?: string }): string => {
	// every writer spawn is handed a role prompt
	expectDefined(systemPrompt);

	const [, template] = systemPrompt.split('\n\n---\n\n# Plan Template\n\n');

	// the chosen template rides under the builder's own label
	expectDefined(template);

	return template;
};
