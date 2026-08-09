---
summary: "a function taking positional arguments where no external contract dictates the shape"
checked: false
severity: advisory
---

## Syntax & Style

- Use arrow functions (unless the codebase uses a different convention)
- **If the function has arguments — exported or private — pass an object and destructure:**
    - **Exported functions:** declare an interface called `Params` for the object argument
    - **Private helpers:** use an inline object type (a file with multiple helpers cannot declare multiple `Params` interfaces)
    - **Why objects:** positional signatures decay under growth — params get appended out of order, middle params can never be removed, and same-typed slots transpose silently (`copyFile(dest, src)` compiles). Object args self-document at every call site.
- **No arguments** → no argument object, no `Params` interface.
- **Sole exception — externally imposed signatures:** a shape dictated by another contract is written as that contract demands, never re-declared locally. Two directions: **callback-shaped** (callbacks to `map`/`reduce`/`sort`, event handlers, framework hooks — the caller dictates) and **pass-through forwarders** (a wrapper forwarding one params object unchanged to a single callee — the callee dictates; type it `Parameters<typeof callee>[0]`, since a hand-copied `Params` would be a shadow contract that drifts).
- If callers need to *name* the argument type (e.g., to pre-build a typed args object), it has become public contract — promote it to a named exported type in `types/` in place of `Params`.
- Export the function as a named export on the line it is defined.
