/**
 * Boot-time lifecycle for the data directory.
 *
 * Called once when the plugin mounts, before the filesystem skill provider is
 * mounted (the patch inserts our row first). Responsibilities, in order:
 *
 *   1. make sure `active/skills` exists;
 *   2. recover an interrupted swap (T03+);
 *   3. seed `active/skills` from the package snapshot when it is empty.
 *
 * "Empty" — not "missing" — is the condition: a user who deliberately emptied
 * the directory gets the seed back, and a half-finished state never silently
 * re-seeds on top of a partially written version.
 */
import { mkdir, readdir, cp } from 'node:fs/promises';
import { join } from 'node:path';

export async function boot({ root, seed }) {
  const active = join(root, 'active', 'skills');
  await mkdir(active, { recursive: true });

  const existing = await readdir(active);
  if (existing.length > 0) return { seeded: false, skills: existing.length };

  if (typeof seed === 'string' && seed !== '') {
    for (const name of await readdir(seed)) {
      await cp(join(seed, name), join(active, name), { recursive: true });
    }
  }

  const skills = await readdir(active);
  return { seeded: true, skills: skills.length };
}
