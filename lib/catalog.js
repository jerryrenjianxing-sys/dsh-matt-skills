/**
 * Skill frontmatter parsing — the pure layer.
 *
 * DSH's own contract: `name` must be kebab-case and unique, `description` must be
 * non-empty; anything else is ignored. A skill that violates it is silently
 * dropped by the host, so the sync refuses the whole batch instead of shipping a
 * snapshot that is quietly 26 skills.
 *
 * Handles the two scalar styles upstream actually uses: a plain one-line value,
 * and a folded/literal block (`>` / `|`) for long descriptions.
 */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSkill(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { error: 'missing frontmatter' };

  const lines = match[1].split(/\r?\n/);
  const fields = {};
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z_][\w.-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;

    let value = kv[2];
    if (/^[>|][+-]?$/.test(value.trim())) {
      const indent = /^[>|]/.test(value.trim()) ? ' ' : '\n';
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        block.push(lines[(i += 1)].trim());
      }
      value = block.join(indent).trim();
    }
    fields[kv[1]] = unquote(value);
  }

  if (!KEBAB.test(fields.name ?? '')) return { error: `invalid name: ${fields.name ?? '(missing)'}` };
  if ((fields.description ?? '') === '') return { error: `missing description: ${fields.name}` };

  return {
    name: fields.name,
    description: fields.description,
    modelInvocable: fields['disable-model-invocation'] !== 'true',
  };
}
