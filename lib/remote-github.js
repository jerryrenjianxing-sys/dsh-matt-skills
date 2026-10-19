/**
 * The real upstream adapter.
 *
 * Three requests, no SDK:
 *   - `releases/latest`      → the tag to track (a tag, never `main`: the spec
 *                              refuses to follow a moving branch)
 *   - `commits/<tag>`        → the commit that tag points at, so "changed" is a
 *                              commit comparison rather than a version-number one
 *                              (a tag can move; a version string can be reused)
 *   - `raw` + `codeload`     → the manifest (whitelist) and the archive
 *
 * `manifest()` resolves the tag itself and stamps the same commit it resolved, so
 * `latest()` and `manifest()` can never disagree about which upstream state they
 * are describing.
 */
const DEFAULT_REPO = 'mattpocock/skills';
const JSON_HEADERS = { 'User-Agent': 'dsh-matt-skills', Accept: 'application/vnd.github+json' };

export function createGitHubRemote({ repo = DEFAULT_REPO, ref, fetchImpl = globalThis.fetch } = {}) {
  async function getJson(url) {
    const response = await fetchImpl(url, { headers: JSON_HEADERS });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  }

  /** A pinned `ref` makes every call describe that exact tag — used for downgrade tests and for pinning. */
  async function resolveTarget() {
    if (typeof ref === 'string' && ref !== '') {
      const commit = await getJson(`https://api.github.com/repos/${repo}/commits/${ref}`);
      if (typeof commit?.sha !== 'string' || commit.sha === '') throw new Error(`no commit for ${ref}`);
      return { tag: ref, commit: commit.sha };
    }
    return resolveLatest();
  }

  async function resolveLatest() {
    const release = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
    const tag = release?.tag_name;
    if (typeof tag !== 'string' || tag === '') throw new Error('no release tag');
    const commit = await getJson(`https://api.github.com/repos/${repo}/commits/${tag}`);
    const sha = commit?.sha;
    if (typeof sha !== 'string' || sha === '') throw new Error(`no commit for ${tag}`);
    return { tag, commit: sha };
  }

  return {
    latest: resolveLatest,

    async manifest() {
      const { tag, commit } = await resolveTarget();
      const response = await fetchImpl(`https://raw.githubusercontent.com/${repo}/${commit}/.claude-plugin/plugin.json`, {
        headers: JSON_HEADERS,
      });
      if (!response.ok) throw new Error(`${response.status} plugin.json`);
      const manifest = await response.json();
      if (typeof manifest?.version !== 'string' || !Array.isArray(manifest?.skills)) {
        throw new Error('plugin.json: unexpected shape');
      }
      return { version: manifest.version, commit, ref: tag, skills: manifest.skills };
    },

    async archive(ref) {
      const response = await fetchImpl(`https://codeload.github.com/${repo}/tar.gz/refs/tags/${ref}`, {
        headers: JSON_HEADERS,
      });
      if (!response.ok) throw new Error(`${response.status} archive ${ref}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
