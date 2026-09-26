/**
 * Whether this deployment is the public site, read from `LIGHTSOUT_PUBLIC`.
 *
 * The one switch between the public pages and the local app. `1` is public:
 * `/app` does not exist, its server functions refuse, and nothing links to it.
 * Unset, empty or `0` is a local dev server, where `/app` reads the repo the
 * app was started in.
 *
 * Any other value throws rather than falling to either side. A typo such as
 * `true` would otherwise read as local and put `/app` on a public site with
 * nobody told — failing the build is the only answer somebody sees.
 *
 * `vite.config.ts` calls this at build time and bakes the checked value into
 * the bundle, because a host's function runtime is not guaranteed the build's
 * environment. Resolved on every call, so a test that changes the variable is
 * answered by the next one.
 *
 * @throws {Error} When `LIGHTSOUT_PUBLIC` holds anything but `1`, `0` or nothing.
 */
export const isPublicDeployment = (): boolean => {
	const value = process.env.LIGHTSOUT_PUBLIC;

	if (value === '1') {
		return true;
	}

	if (value === undefined || value === '' || value === '0') {
		return false;
	}

	throw new Error(`LIGHTSOUT_PUBLIC is '${value}' — set it to 1 for the public site, or leave it unset (or 0) for a local dev server.`);
};
