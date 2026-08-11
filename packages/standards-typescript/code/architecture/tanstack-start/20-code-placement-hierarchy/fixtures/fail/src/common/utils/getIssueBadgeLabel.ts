// App-wide placement for something only one screen's components use — the
// hierarchy asks for the narrowest scope that covers every consumer.
export const getIssueBadgeLabel = ({ count }: { count: number }): string => `${count} open`;
