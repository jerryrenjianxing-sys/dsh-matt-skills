/**
 * The sync feature: one module, three verbs (`sync`, `status`, `rollback`), and
 * one injected adapter (`Remote`).
 *
 * Every decision that can be made without IO is made from data already in hand:
 * whether the upstream changed is a `commit` comparison, never a "did the remote
 * say 304" courtesy of the adapter.
 *
 * Layout under `root`:
 *   active/skills/<name>/…   the only path the skill provider reads
 *   staging/<version>/…      written first, renamed into place only when valid
 *   trash/<version>/skills   the version swapped out, kept for one rollback
 *   lock.json                version / commit / per-file hash / last check
 */
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, posix } from 'node:path';
import { untarGz } from './tar.js';
import { parseSkill } from './catalog.js';

const LOCK_FILE = 'lock.json';

const clean = (rel) => rel.replace(/^\.\//, '').replace(/\/+$/, '');
const skillName = (rel) => posix.basename(clean(rel));

async function readLock(root) {
  try {
    return JSON.parse(await readFile(join(root, LOCK_FILE), 'utf8'));
  } catch {
    return undefined;
  }
}

async function writeLock(root, lock) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

/** Archive roots are `<repo>-<sha>/`; every real entry shares it. */
function archivePrefix(entries) {
  for (const entry of entries) {
    if (entry.type === '5') continue;
    const slash = entry.name.indexOf('/');
    if (slash > 0) return entry.name.slice(0, slash);
  }
  return undefined;
}

async function countSkills(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

/** `path → sha256` for every file under `dir`, keyed relative to `dir`. */
async function hashTree(dir) {
  const out = {};
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(full, rel);
      else out[rel] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  await walk(dir, '');
  return out;
}

/** Collapse a `path → sha256` map into `skillName → digest`, so a whole skill compares as one value. */
function groupBySkill(fileHashes) {
  const groups = {};
  for (const [rel, hash] of Object.entries(fileHashes)) {
    const skill = rel.split('/')[0];
    (groups[skill] ??= []).push(`${rel}=${hash}`);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([skill, list]) => [skill, createHash('sha256').update(list.sort().join('\n')).digest('hex')]),
  );
}

export function createFeature({ remote, root: boundRoot, now = () => new Date().toISOString() }) {
  async function status() {
    if (boundRoot === undefined) return undefined;
    const lock = await readLock(boundRoot);
    if (!lock) return undefined;
    return {
      version: lock.current?.version ?? 'none',
      commit: lock.current?.commit ?? 'none',
      skills: await countSkills(join(boundRoot, 'active', 'skills')),
      lastCheck: lock.lastCheck?.at,
    };
  }

  async function sync(rootArg) {
    const root = rootArg ?? boundRoot;
    const previous = await readLock(root);
    const keptVersion = previous?.current?.version ?? 'none';
    const fail = async (error) => {
      await rm(join(root, 'staging'), { recursive: true, force: true });
      if (previous) await writeLock(root, { ...previous, lastCheck: { at: now(), result: 'failed', error } });
      return { kind: 'failed', error, keptVersion };
    };

    let manifest;
    try {
      manifest = await remote.manifest();
    } catch (error) {
      return fail(`manifest: ${error?.message ?? String(error)}`);
    }

    if (previous?.current?.commit === manifest.commit) {
      await writeLock(root, { ...previous, lastCheck: { at: now(), result: 'not-modified' } });
      return { kind: 'not-modified', version: previous.current.version };
    }

    let entries;
    try {
      entries = untarGz(await remote.archive(manifest.ref));
    } catch (error) {
      return fail(`archive: ${error?.message ?? String(error)}`);
    }

    const prefix = archivePrefix(entries);
    if (prefix === undefined) return fail('archive: no root directory');

    const staging = join(root, 'staging', manifest.version);
    const stagedSkills = join(staging, 'skills');
    await rm(staging, { recursive: true, force: true });
    await mkdir(stagedSkills, { recursive: true });

    const wanted = manifest.skills.map(clean);
    for (const rel of wanted) {
      const name = skillName(rel);
      const base = `${prefix}/${rel}`;
      for (const entry of entries) {
        if (entry.type !== '0' || !entry.name.startsWith(`${base}/`)) continue;
        const inner = entry.name.slice(base.length + 1);
        if (inner === '' || inner.includes('..')) continue;
        const target = join(stagedSkills, name, inner);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, entry.data);
      }
    }

    // Validate before touching anything live: every promised skill must exist and
    // satisfy the host's frontmatter contract. One bad skill fails the batch —
    // silently shipping 26 of 27 is worse than not shipping.
    for (const rel of wanted) {
      const name = skillName(rel);
      const skillMd = join(stagedSkills, name, 'SKILL.md');
      const text = await readFile(skillMd, 'utf8').catch(() => undefined);
      if (text === undefined) return fail(`validation: ${name} has no SKILL.md`);
      const parsed = parseSkill(text);
      if (parsed.error !== undefined) return fail(`validation: ${name}: ${parsed.error}`);
      if (parsed.name !== name) return fail(`validation: ${name}: frontmatter name is "${parsed.name}"`);
    }

    const activeSkills = join(root, 'active', 'skills');
    const old = previous?.current;

    // The live DSH process watches `active/skills`, and Windows refuses to rename
    // a watched directory (EPERM), so nothing here renames a directory that the
    // provider knows about. Instead: copy the current content aside for rollback,
    // then reconcile the children in place. The provider's watcher turns that into
    // add/unlink events and refreshes the catalog on its own.
    const trashSkills = join(root, 'trash', old?.version ?? `pre-${Date.now()}`, 'skills');

    try {
      const activeExists = await stat(activeSkills).then((s) => s.isDirectory()).catch(() => false);
      if (activeExists) {
        await rm(dirname(trashSkills), { recursive: true, force: true });
        await mkdir(dirname(trashSkills), { recursive: true });
        await cp(activeSkills, trashSkills, { recursive: true });
      }

      await mkdir(activeSkills, { recursive: true });
      const next = new Set(wanted.map(skillName));
      for (const entry of await readdir(activeSkills, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (!next.has(entry.name)) await rm(join(activeSkills, entry.name), { recursive: true, force: true });
      }
      for (const name of next) {
        await rm(join(activeSkills, name), { recursive: true, force: true });
        await cp(join(stagedSkills, name), join(activeSkills, name), { recursive: true });
      }
    } catch (error) {
      return fail(`swap: ${error?.message ?? String(error)}`);
    }

    await rm(staging, { recursive: true, force: true });

    const newHashes = await hashTree(activeSkills);
    const newGroups = groupBySkill(newHashes);
    const oldGroups = old === undefined ? {} : groupBySkill(previous?.current?.skills ?? {});
    const before = Object.keys(oldGroups);
    const after = Object.keys(newGroups);

    const lock = {
      schemaVersion: 1,
      upstream: { repo: 'mattpocock/skills', kind: 'tag' },
      current: {
        version: manifest.version,
        ref: manifest.ref ?? `v${manifest.version}`,
        commit: manifest.commit,
        installedAt: now(),
        skills: newHashes,
      },
      ...(old ? { previous: { version: old.version, dir: `trash/${old.version}` } } : {}),
      lastCheck: { at: now(), result: 'updated' },
    };
    await writeLock(root, lock);

    return {
      kind: 'updated',
      from: old?.version ?? 'none',
      to: manifest.version,
      added: after.filter((name) => !before.includes(name)),
      removed: before.filter((name) => !after.includes(name)),
      changed: after.filter((name) => before.includes(name) && newGroups[name] !== oldGroups[name]),
      root,
    };
  }

  async function preview(rootArg) {
    const root = rootArg ?? boundRoot;
    const lock = await readLock(root);

    let manifest;
    try {
      manifest = await remote.manifest();
    } catch (error) {
      return { kind: 'failed', error: `manifest: ${error?.message ?? String(error)}`, keptVersion: lock?.current?.version ?? 'none' };
    }

    const upstreamNames = manifest.skills.map(clean).map(skillName);
    const localNames = Object.keys(groupBySkill(lock?.current?.skills ?? {}));
    const upToDate = lock?.current?.commit === manifest.commit;

    return {
      kind: 'preview',
      current: lock ? { version: lock.current.version, commit: lock.current.commit, skills: localNames.length } : null,
      upstream: {
        version: manifest.version,
        ref: manifest.ref ?? `v${manifest.version}`,
        commit: manifest.commit,
        skills: upstreamNames.length,
      },
      upToDate,
      added: upstreamNames.filter((name) => !localNames.includes(name)),
      removed: localNames.filter((name) => !upstreamNames.includes(name)),
      changed: upToDate ? [] : null,
      note: upToDate ? 'already up to date' : 'per-file changes are only known after apply',
    };
  }

  async function rollback(rootArg) {
    const root = rootArg ?? boundRoot;
    const lock = await readLock(root);
    const previous = lock?.previous;
    if (!previous) return { kind: 'failed', error: 'no previous version' };

    const trashSkills = join(root, previous.dir, 'skills');
    const exists = await stat(trashSkills).catch(() => undefined);
    if (exists?.isDirectory() !== true) return { kind: 'failed', error: `trash missing: ${previous.dir}` };

    const activeSkills = join(root, 'active', 'skills');
    await rm(activeSkills, { recursive: true, force: true });
    await mkdir(dirname(activeSkills), { recursive: true });
    await cp(trashSkills, activeSkills, { recursive: true });

    await writeLock(root, {
      ...lock,
      current: { ...lock.current, version: previous.version },
      previous: undefined,
      lastCheck: { at: now(), result: 'updated' },
    });
    return { kind: 'rolled-back', to: previous.version };
  }

  return { sync, status, preview, rollback };
}
