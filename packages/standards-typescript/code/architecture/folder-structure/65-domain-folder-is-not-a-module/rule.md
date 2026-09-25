---
summary: "a domain folder under `common/` carrying a file that serves only its siblings"
checked: false
severity: advisory
---

A domain folder is **not** a concept with parts of its own — by the companion test every file in it is something its users call directly, and imports target those files one by one. The moment a domain folder needs a file that serves only its siblings, it has become a concept of its own and moves out of `common/`.
