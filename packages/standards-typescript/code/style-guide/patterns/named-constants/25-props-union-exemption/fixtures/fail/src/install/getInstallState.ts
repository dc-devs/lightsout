// The literals cross a module boundary and get narrowed here as well, which is
// what makes them domain values rather than a prop vocabulary.
export const getInstallState = ({ token }: { token: string | null }): 'notInstalled' | 'connected' => (token === null ? 'notInstalled' : 'connected');
