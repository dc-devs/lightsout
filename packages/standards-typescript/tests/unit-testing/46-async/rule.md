---
summary: "an async unit arranged or asserted without the resolved/rejected forms the document names"
checked: false
severity: advisory
---

### Async

Configure with `mockResolvedValue` / `mockRejectedValue` in the setup factory; `await` the act in the test; assert rejections with `await expect(...).rejects.toThrow(...)` — the one place the act sits inside the assertion.
