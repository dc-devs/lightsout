interface Props {
	status: 'connected' | 'notInstalled';
}

// A folder and a barrel around a component that bundles no utilities, types or
// constants — the folder is the default only once there is something to bundle.
export const StatusBadge = ({ status }: Props) => <span className={status}>{status}</span>;
