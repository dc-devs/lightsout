/** Rule ids the default pack has renamed, old to new. Saved configs and runs can still carry the old ones. */
export const renamedRuleIds: Readonly<Record<string, string>> = {
	'crowded-folder': 'folder-size',
	'size-file': 'file-size',
	'size-function': 'function-size',
	'test-size-file': 'test-file-size',
};
