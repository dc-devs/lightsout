/**
 * A stub standards reviewer's final message: a valid StandardsReviewReport as
 * bare JSON. The default is an empty list, which is the answer a stub driver
 * wants for every test that is not about the review itself.
 */
export const reviewReport = (findings: Record<string, unknown>[] = []) => JSON.stringify({ findings });
