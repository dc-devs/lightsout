interface Params {
	user: { name: string | null } | null;
}

// Exported with an implicit contract: whatever the body happens to return today
// is what consumers are compiled against.
export const getUserDisplayName = ({ user }: Params) => user?.name ?? 'Unknown';
