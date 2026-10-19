#!/usr/bin/env node
/**
 * Manual driver for the sync feature. The `matt_sync` tool is the in-conversation
 * surface; this is its human-facing equivalent, and what an acceptance run uses.
 *
 *   node bin/matt-sync.mjs status
 *   node bin/matt-sync.mjs check
 *   node bin/matt-sync.mjs apply
 *   node bin/matt-sync.mjs rollback
 *
 *   --root <path>   data directory (default: $DSH_HOME/matt-skills)
 *   --ref <tag>     pin a specific upstream tag instead of the latest release
 *                   (used to reproduce a downgrade, which is also the
 *                   precondition for exercising rollback against real archives)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createFeature } from '../lib/sync.js';
import { createGitHubRemote } from '../lib/remote-github.js';

const argv = process.argv.slice(2);
const action = argv[0] ?? 'status';

function option(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

const root = option('root') ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'matt-skills');
const ref = option('ref');

const remote = createGitHubRemote(ref === undefined ? {} : { ref });
const feature = createFeature({ remote, root });
const say = (value) => console.log(JSON.stringify(value, null, 2));

if (action === 'check') {
  say(await feature.preview(root));
} else if (action === 'apply') {
  say(await feature.sync(root));
} else if (action === 'rollback') {
  say(await feature.rollback(root));
} else if (action === 'status') {
  say(await feature.status());
} else {
  console.error(`unknown action: ${action}`);
  process.exitCode = 2;
}
