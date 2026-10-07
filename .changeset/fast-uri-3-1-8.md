---
'@modelcontextprotocol/core-internal': patch
'@modelcontextprotocol/client': patch
'@modelcontextprotocol/server': patch
---

Force `fast-uri` to 3.1.8 across the workspace. Versions up to 3.1.7 are affected by nine published advisories (GHSA-4c8g-83qw-93j6, GHSA-7p8r-x3mc-p8w7, GHSA-f65p-4m7j-42xc, GHSA-hrr3-gc8f-f4qj, GHSA-jqff-g426-hqxp, GHSA-q3j6-qgpj-74h6, GHSA-qw65-cvwx-89v3, GHSA-v2hh-gcrm-f6hx, GHSA-v39h-62p7-jpjc), all fixed in 3.1.8. `fast-uri` reaches the SDK only through `ajv`, whose range (`^3.0.1`) already accepts the new version. The override matters because `client` and `server` bundle `ajv` into `dist/`, so consumers cannot replace the inlined copy with their own overrides.
