---
'@modelcontextprotocol/core-internal': patch
'@modelcontextprotocol/client': patch
'@modelcontextprotocol/server': patch
---

Register the `json` format as a no-op on default AJV instances to silence "unknown format" warnings.

Some MCP servers (e.g. Notion MCP) annotate schema properties with `"format": "json"`, which is defined neither by JSON Schema nor by `ajv-formats`. Compiling those schemas through the default validator instances logged an `unknown format "json" ignored` warning per property (twice each with `allErrors: true`). Registering `json` with `ajv.addFormat('json', true)` on all three dialect engines (2020-12, 2019-09, draft-07) silences the warning without changing validation behaviour — the format performs no validation, and AJV already ignored it.
