// `applyRenames` and `countTokens` are deliberately not published: they are the
// two halves of the one judgment below, and a caller holding either on its own
// could compare a change by a rule the check does not apply.

export { checkRenameOnlyChanges } from '#src/pipeline/renameCheck/checkRenameOnlyChanges.ts';
