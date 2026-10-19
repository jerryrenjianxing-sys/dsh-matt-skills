import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeature } from '../lib/sync.js';
import { boot } from '../lib/boot.js';

const V131 = new URL('./fixtures/upstream-1.3.1.tar.gz', import.meta.url);
const V132 = new URL('./fixtures/upstream-1.3.2.tar.gz', import.meta.url);
const VBAD = new URL('./fixtures/upstream-bad-frontmatter.tar.gz', import.meta.url);

const SKILLS_131 = ['./skills/engineering/codebase-design', './skills/productivity/tdd'];
const SKILLS_132 = [...SKILLS_131, './skills/engineering/research'];

/** 假远端只给字节与清单；判"有没有变化"是 Sync 的事，不靠适配器假装 304。 */
function remoteV(version, commit, skills, archive, overrides = {}) {
  return {
    latest: async () => ({ tag: `v${version}`, commit }),
    manifest: async () => ({ version, commit, ref: `v${version}`, skills }),
    archive: async () => readFile(archive),
    ...overrides,
  };
}

const remote131 = () => remoteV('1.3.1', 'sha-49dd158', SKILLS_131, V131);
const remote132 = () => remoteV('1.3.2', 'sha-bb22aa11', SKILLS_132, V132);

async function skillNames(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** 测试内自算哈希，不 import 生产的 signature —— 否则就是同义反复。 */
async function hashTree(dir) {
  const out = {};
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, rel);
      else out[rel] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  await walk(dir, '');
  return out;
}

const tmpRoot = () => mkdtemp(join(tmpdir(), 'matt-sync-'));

test('sync 把上游快照展平（剥 <repo>-<sha>/ 前缀、去 bucket 层）落进 active/skills', async () => {
  const root = await tmpRoot();
  const feature = createFeature({ remote: remote131() });

  const result = await feature.sync(root);

  assert.equal(result.kind, 'updated');
  assert.deepEqual(await skillNames(join(root, 'active', 'skills')), ['codebase-design', 'tdd']);
});

test('同一上游再同步一次：返回 not-modified，且 active 里的文件字节完全不变', async () => {
  const root = await tmpRoot();
  const feature = createFeature({ remote: remote131() });
  await feature.sync(root);
  const before = await hashTree(join(root, 'active', 'skills'));

  const second = await feature.sync(root);

  assert.equal(second.kind, 'not-modified');
  assert.deepEqual(await hashTree(join(root, 'active', 'skills')), before);
});

test('上游新增技能：added 只说新增的那个，两个老技能记在 changed 里', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);

  const result = await createFeature({ remote: remote132() }).sync(root);

  assert.equal(result.kind, 'updated');
  assert.deepEqual(result.added, ['research'], 'added 只含真正新增的技能');
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.changed.sort(), ['codebase-design', 'tdd'], '内容变了的技能进 changed');
  assert.deepEqual(await skillNames(join(root, 'active', 'skills')), ['codebase-design', 'research', 'tdd']);
});

test('check（preview）不下载就能报出增减，且不改动任何文件', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);
  const before = await hashTree(join(root, 'active', 'skills'));

  const preview = await createFeature({ remote: remote132() }).preview(root);

  assert.equal(preview.kind, 'preview');
  assert.equal(preview.upToDate, false);
  assert.deepEqual(preview.added, ['research']);
  assert.deepEqual(preview.removed, []);
  assert.equal(preview.changed, null, '文件级差异要 apply 之后才知道');
  assert.equal(preview.current.version, '1.3.1');
  assert.equal(preview.upstream.version, '1.3.2');
  assert.deepEqual(await hashTree(join(root, 'active', 'skills')), before, 'preview 不得改动 active');
});

test('check 在上游没变时明确说已是最新', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);

  const preview = await createFeature({ remote: remote131() }).preview(root);

  assert.equal(preview.upToDate, true);
  assert.deepEqual(preview.added, []);
  assert.deepEqual(preview.changed, []);
});

test('坏包（截断的 tar.gz）：返回 failed，active 内容一个字节都不变', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);
  const before = await hashTree(join(root, 'active', 'skills'));

  const broken = remoteV('1.3.3', 'sha-deadbeef', SKILLS_131, V131, {
    archive: async () => Buffer.from('not a gzip at all'),
  });
  const result = await createFeature({ remote: broken }).sync(root);

  assert.equal(result.kind, 'failed');
  assert.equal(result.keptVersion, '1.3.1');
  assert.deepEqual(await hashTree(join(root, 'active', 'skills')), before);
});

test('上游有技能 frontmatter 非法：整批拒绝，active 不变，staging 被清空', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);
  const before = await hashTree(join(root, 'active', 'skills'));

  const bad = remoteV('1.3.9', 'sha-cccccc', ['./skills/engineering/codebase-design'], VBAD);
  const result = await createFeature({ remote: bad }).sync(root);

  assert.equal(result.kind, 'failed');
  assert.match(result.error, /invalid name/);
  assert.deepEqual(await hashTree(join(root, 'active', 'skills')), before);
  assert.deepEqual(await skillNames(join(root, 'staging')), [], 'staging 根应为空');
});

test('连续三次失败后 staging 根仍然为空（内部卫生）', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);

  const bad = remoteV('1.3.9', 'sha-cccccc', ['./skills/engineering/codebase-design'], VBAD);
  for (let i = 0; i < 3; i += 1) await createFeature({ remote: bad }).sync(root);

  assert.deepEqual(await skillNames(join(root, 'staging')), []);
});

test('种子快照已存在、但还没有 lock 时，同步仍能替换（Windows rename 语义）', async () => {
  const root = await tmpRoot();
  const seed = await mkdtemp(join(tmpdir(), 'matt-seed-'));
  await mkdir(join(seed, 'stale-skill'), { recursive: true });
  await writeFile(join(seed, 'stale-skill', 'SKILL.md'), '---\nname: stale-skill\ndescription: from the package\n---\n', 'utf8');
  await boot({ root, seed });

  const result = await createFeature({ remote: remote131() }).sync(root);

  assert.equal(result.kind, 'updated');
  assert.deepEqual(await skillNames(join(root, 'active', 'skills')), ['codebase-design', 'tdd']);
});

test('回滚：从 v1.3.2 退回 v1.3.1 的内容，status 报的版本也退回去', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);
  await createFeature({ remote: remote132() }).sync(root);
  assert.deepEqual(await skillNames(join(root, 'active', 'skills')), ['codebase-design', 'research', 'tdd']);

  const feature = createFeature({ remote: remote131(), root });
  const result = await feature.rollback();

  assert.equal(result.kind, 'rolled-back');
  assert.equal(result.to, '1.3.1');
  assert.deepEqual(await skillNames(join(root, 'active', 'skills')), ['codebase-design', 'tdd']);
  assert.equal((await feature.status()).version, '1.3.1');
});

test('没有上一版时回滚返回 failed，而不是猜一个版本', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);

  const result = await createFeature({ remote: remote131(), root }).rollback();

  assert.equal(result.kind, 'failed');
});

test('断网（manifest 抛错）：返回 failed，keptVersion 是当前版本，active 不变', async () => {
  const root = await tmpRoot();
  await createFeature({ remote: remote131() }).sync(root);
  const before = await hashTree(join(root, 'active', 'skills'));

  const offline = remoteV('1.3.2', 'sha-bb22aa11', SKILLS_132, V132, {
    manifest: async () => {
      throw new Error('EAI_AGAIN getaddrinfo');
    },
  });
  const result = await createFeature({ remote: offline }).sync(root);

  assert.equal(result.kind, 'failed');
  assert.equal(result.keptVersion, '1.3.1');
  assert.deepEqual(await hashTree(join(root, 'active', 'skills')), before);
});
