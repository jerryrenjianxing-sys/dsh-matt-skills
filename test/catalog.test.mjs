import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkill } from '../lib/catalog.js';

test('parseSkill 读一行式 frontmatter', () => {
  const skill = parseSkill('---\nname: tdd\ndescription: Test-first loop.\n---\n\n# body\n');
  assert.deepEqual(skill, { name: 'tdd', description: 'Test-first loop.', modelInvocable: true });
});

test('parseSkill 读折行描述的块写法（上游长描述常见）', () => {
  const text = '---\nname: grilling\ndescription: >\n  Grill the user relentlessly.\n  Rounds, not one shot.\n---\n';
  assert.equal(parseSkill(text).description, 'Grill the user relentlessly. Rounds, not one shot.');
});

test('parseSkill 把 disable-model-invocation 翻译成 modelInvocable', () => {
  const skill = parseSkill('---\nname: handoff\ndescription: Compact it.\ndisable-model-invocation: true\n---\n');
  assert.equal(skill.modelInvocable, false);
});

test('parseSkill 拒绝非 kebab-case 的名字', () => {
  assert.match(parseSkill('---\nname: Bad_Name\ndescription: x\n---\n').error, /invalid name/);
});

test('parseSkill 拒绝空描述', () => {
  assert.match(parseSkill('---\nname: tdd\ndescription:\n---\n').error, /missing description/);
});

test('parseSkill 拒绝没有 frontmatter 的文件', () => {
  assert.match(parseSkill('# just a heading\n').error, /missing frontmatter/);
});
