// No object behind it, so every caller writes `doThing('add')` and the source
// of truth becomes "everywhere".
export type Action = 'add' | 'remove' | 'list' | 'update';
