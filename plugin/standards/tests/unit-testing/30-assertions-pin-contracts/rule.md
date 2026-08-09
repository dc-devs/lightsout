---
summary: "an assertion that restates the module under test instead of stating its contract independently"
checked: false
severity: advisory
---

### Assertions Pin Contracts

- **Assert with literals — never import a constant from the module under test into its own assertions.** A test comparing `x` to `x` is a tautology that passes even when the value is wrong; the literal in the test is the independent second statement of the contract. (Duplication between a source constant and its test literal is contract-pinning, not a DRY violation.) Constants from *other* modules — shared enums the codebase already defines — are fine as inputs.
- **Pin machine-facing values strictly, human-facing copy loosely.** Error codes, event names, and API fields get exact assertions; UI copy and log messages get `stringContaining`/regex or no assertion at all — wording changes shouldn't fail contract tests.
- **Construct the subject under test directly; stub only unowned boundaries** (network, filesystem, other modules' services). Don't mock what you own and could simply instantiate.
- **Prefer behavior assertions over property echoes** — assert what the unit *does* (output, side effect at its boundary), not that a value passed in reappears unchanged.
