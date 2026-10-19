# Third-party notices

## mattpocock/skills

This package redistributes the 27 promoted skills from
[mattpocock/skills](https://github.com/mattpocock/skills), unmodified.

- Upstream version: 1.3.1
- Upstream commit: 49dd158d1076134a641b33efb035946536778336
- License: MIT
- Copyright: Matt Pocock

The upstream skill files under `skills/` are byte-for-byte copies of the files
listed in the upstream `.claude-plugin/plugin.json`. The full upstream license
text is reproduced in `LICENSE-mattpocock-skills`.

Nothing in this package modifies, translates, or re-orders the upstream skill
content; the only thing added is the DSH bundle declaration
(`package.json` + `cordis.patch.yml`) and this notice.

## Not redistributed

The upstream repository also contains non-promoted buckets (`in-progress/`,
`misc/`, `deprecated/`) and project metadata (`.changeset/`, `.github/`,
`docs/`, `scripts/`). Those are intentionally not included here.
