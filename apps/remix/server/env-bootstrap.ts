import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * When the dev server is started without `dotenv-cli` (e.g. IDE "Run" on vite/react-router),
 * `ANTHROPIC_API_KEY` from the repo-root `.env` never reaches `process.env`. Load those files
 * here in development only; production relies on injected env (Docker, hosting).
 */
if (process.env.NODE_ENV !== 'production') {
  config({ path: path.join(here, '../../../.env') });
  config({ path: path.join(here, '../../../.env.local') });
}
