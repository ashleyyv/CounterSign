#!/usr/bin/env node

/* eslint-disable no-console */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (process.env.DOCUMENSO_SKIP_DEV_DOCKER === 'true') {
  console.log('[documenso] Skipping dev database (DOCUMENSO_SKIP_DEV_DOCKER=true).');
  process.exit(0);
}

const composeFile = path.join(__dirname, '..', 'docker', 'development', 'compose.yml');

const result = spawnSync('docker', ['compose', '-f', composeFile, 'up', '-d', 'database'], {
  stdio: 'inherit',
});

if (result.error) {
  console.error('[documenso] Could not run Docker:', result.error.message);
  console.error(
    'Start Docker Desktop, or set DOCUMENSO_SKIP_DEV_DOCKER=true if you use another Postgres URL.',
  );
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
