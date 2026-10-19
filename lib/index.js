/**
 * dsh-matt-skills — bundle entry.
 *
 * At mount time it prepares the data directory (`$DSH_HOME/matt-skills/active/skills`)
 * by seeding it from the package snapshot on first run. The patch mounts this row
 * before the filesystem skill provider row, and returning the promise makes cordis
 * wait, so the provider never lists an unseeded directory.
 *
 * It also registers `matt_sync`, the manual control surface: "check / apply /
 * rollback". Deliberately model-invoked rather than a background task — the skill
 * body is prompt content, so following a moving upstream without a human saying
 * so is a supply-chain decision, not a convenience.
 */
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { boot } from './boot.js';
import { createFeature } from './sync.js';
import { createGitHubRemote } from './remote-github.js';

export const name = 'dsh-matt-skills';
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const seed = fileURLToPath(new URL('../skills/', import.meta.url));
  const root = typeof config.root === 'string' && config.root !== ''
    ? config.root
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'matt-skills');

  const remote = createGitHubRemote();
  const feature = createFeature({ remote, root });

  const ready = boot({ root, seed })
    .then((result) => {
      ctx.logger?.info?.(`[matt-skills] boot: seeded=${String(result.seeded)} skills=${String(result.skills)} root=${root}`);
      return result;
    })
    .catch((error) => {
      ctx.logger?.error?.(`[matt-skills] boot failed: ${error?.message ?? String(error)}`);
    });

  const register = () => ctx.tools.register({
    name: 'matt_sync',
    description:
      'Inspect, update, or roll back the Matt Pocock skill set bundled with this plugin. '
      + 'Use `check` before updating to see whether upstream moved; `apply` downloads the new snapshot '
      + 'and swaps it in without reinstalling the plugin; `rollback` restores the previous snapshot.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'check', 'apply', 'rollback'],
          description: 'status = current version only; check = ask upstream whether it moved (no download); apply = sync; rollback = restore the previous snapshot.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      await ready;
      const action = args?.action ?? 'status';
      try {
        if (action === 'check') return { action, ...(await feature.preview(root)) };
        if (action === 'apply') return { action, ...(await feature.sync(root)) };
        if (action === 'rollback') return { action, ...(await feature.rollback(root)) };
        return { action: 'status', root, current: await feature.status() };
      } catch (error) {
        return { action, failed: error?.message ?? String(error) };
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Matt skills: ${String(args?.action ?? 'status')}`,
      kind: 'read',
    }),
  });

  if (ctx.tools && typeof ctx.tools.register === 'function') {
    if (typeof ctx.effect === 'function') ctx.effect(register, 'matt_sync tool');
    else register();
  }

  return ready;
}
