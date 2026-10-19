import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from '../lib/boot.js';

async function seedDir(names) {
  const dir = await mkdtemp(join(tmpdir(), 'matt-seed-'));
  for (const name of names) {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\n\n# ${name}\n`, 'utf8');
  }
  return dir;
}

test('boot 在数据目录为空时，把包内快照种进 active/skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'matt-root-'));
  const seed = await seedDir(['tdd', 'grilling']);

  await boot({ root, seed });

  const names = (await readdir(join(root, 'active', 'skills'))).sort();
  assert.deepEqual(names, ['grilling', 'tdd']);
});

test('boot 不覆盖已存在的 active/skills（保护同步后的内容）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'matt-root-'));
  const seed = await seedDir(['tdd', 'grilling']);
  const active = join(root, 'active', 'skills');
  await mkdir(join(active, 'local-only'), { recursive: true });
  await writeFile(join(active, 'local-only', 'SKILL.md'), '---\nname: local-only\ndescription: mine\n---\n', 'utf8');

  await boot({ root, seed });

  const names = (await readdir(active)).sort();
  assert.deepEqual(names, ['local-only'], '已有内容时不应再种入快照');
});

test('boot 在 active/skills 被删掉后能自愈重建', async () => {
  const root = await mkdtemp(join(tmpdir(), 'matt-root-'));
  const seed = await seedDir(['tdd']);

  await boot({ root, seed });
  await rm(join(root, 'active'), { recursive: true, force: true });
  await boot({ root, seed });

  const raw = await readFile(join(root, 'active', 'skills', 'tdd', 'SKILL.md'), 'utf8');
  assert.match(raw, /name: tdd/);
});
