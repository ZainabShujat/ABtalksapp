<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Neon database safety (hard rule)

- Before any Neon schema or data mutation (migration, seed, backfill, cleanup, or ad-hoc SQL), create a child branch from production and explicitly target only that child by branch ID or child connection string.
- Never write to the default/production branch unless the user explicitly authorizes that exact production write in the current request. If the target cannot be proven to be the child, stop.
