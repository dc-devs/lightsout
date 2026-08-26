---
summary: "a setup factory grown past its parameter cap"
checked: true
severity: advisory
settings:
  maxParams: 6
---

- **One factory configures any number of mocks** — a single factory call is the whole arrangement; variants come from parameters.
- **A single explicit override is allowed** for the one variable a test varies (`setupAvatar()` then one `mockReturnValue` line).
- **Keep a factory from sprawling.** A substantially different arrangement gets a second named factory (`setupEmployee`), rather than another parameter on the first one.
