# dsh-matt-skills

把 [mattpocock/skills](https://github.com/mattpocock/skills) 的 27 个工程技能做成一个
**可整包开关、可手动增量更新**的 DeepSeek Harness (DSH) 插件。上游内容一字不改。

## 它做什么

- **装一次**：通过 DSH 插件页安装，之后不再重装。
- **整包开关**：插件页里启用/禁用这个 bundle，整组技能立刻出现或消失（热生效，不用重启）。
- **内置快照**：包内带一份上游原文，断网、首启、更新失败都有东西可用。
- **手动更新**：`matt_sync` 工具检查并应用上游新版本，只替换数据目录里的内容，**不动插件包**；失败保留旧版，可回滚。

## 它长什么样

**问上游有没有新版**（不下载，只比对 commit）：

```json
{
  "kind": "preview",
  "current":  { "version": "1.3.1", "commit": "24fe0ef…", "skills": 27 },
  "upstream": { "version": "1.3.1", "commit": "24fe0ef…", "skills": 27 },
  "upToDate": true,
  "added": [], "removed": [], "changed": [],
  "note": "already up to date"
}
```

上游真发了新版时，同样的调用会把新增/消失的技能直接列在 `added` / `removed` 里。

**应用更新**（只换数据目录，插件包不重装）：

```json
{ "kind": "updated", "from": "1.3.1", "to": "1.3.2",
  "added": ["research"], "removed": [], "changed": ["tdd", "codebase-design"] }
```

**回滚**：

```json
{ "kind": "rolled-back", "to": "1.3.1" }
```

内容逐字节回到上一版，`status().version` 同步回退。

## 和已有的几个移植有什么不同

社区里已有 8 个以上 mattpocock→DSH 的移植（多数把技能直接摊进全局技能目录）。这个项目的取舍不同：

- **开关是 DSH 自己的**：不用自研 UI、不用 `state.json`，就是插件页里的启用/禁用，靠 bundle 层热生效。
- **内容与代码分离**：更新只换 `$DSH_HOME/matt-skills/active/skills`，插件包永远不重装，失败时旧版一个字节都不动。
- **零依赖官方 provider 之外的东西**：只插一行 `@deepseek-ai/dsh-skill-filesystem`，不写自定义 provider。
- **整批校验**：27 个里任何一个 frontmatter 不合法就整次失败，不会悄悄变成 26 个。


## 结构

```
包内（只读，装完基本不动）        数据目录（会变）
├─ lib/                           $DSH_HOME/matt-skills/
│   ├─ index.js   挂载 + 工具      ├─ active/skills/<name>/   ← provider 唯一读取路径
│   ├─ boot.js    种子/自愈        ├─ staging/<version>/      ← 写这里，校验通过才换
│   ├─ sync.js    同步/回滚        ├─ trash/<version>/        ← 被换下的版本（回滚用）
│   ├─ catalog.js frontmatter 校验 └─ lock.json              ← 版本/提交/文件哈希/上次检查
│   ├─ tar.js     tar 解析
│   └─ remote-github.js  上游适配器
├─ bin/matt-sync.mjs  手动驱动
├─ skills/            27 个技能（上游原文）
└─ cordis.patch.yml   两行：boot + 官方 skill-filesystem
```

## 安装

DSH 的插件安装本质上就是「往 profile 装一个 npm 包，并把它加进 `dsh.profile.bundles`」，
所以任何 pnpm 认得的来源都能装：npm 包名、本地目录、`github:user/repo`、tarball。

```powershell
# 从 GitHub 装（推荐给使用者）
dsh plugin --profile desktop add github:jerryrenjianxing-sys/dsh-matt-skills

# 从本地目录装（开发时用）
dsh plugin --profile desktop add C:\path\to\dsh-matt-skills
```

也可以直接在 DSH 的**插件页**里添加（它内部调用的就是同一个 `installBundle`）。

装完重启一次 DSH。之后开关和更新都不再需要重启。

> `dsh plugin --profile <名字>` 里的 profile 必须是你实际在用的那个：桌面应用是 `desktop`，
> 用 `dsh web` 自启的是 `web`。装错 profile 等于没装。

## 用法

对话里：

- 「看看 Matt 技能有没有更新」→ `matt_sync { action: "check" }`
- 「更新一下 Matt 技能」→ `matt_sync { action: "apply" }`
- 「把 Matt 技能退回上一版」→ `matt_sync { action: "rollback" }`

命令行：

```powershell
node bin/matt-sync.mjs check
node bin/matt-sync.mjs apply
node bin/matt-sync.mjs rollback
node bin/matt-sync.mjs status
```

## 开关

在 DSH 插件页找到 `dsh-matt-skills`，启用/禁用即可。它改的是 profile 的
`dsh.profile.bundles`，HMR 会立刻重组，**无需重启**。

## 行为约定

- **跟踪 release tag，不跟 `main`**：main 是移动靶。
- **按 commit 判变化**，不按版本号——tag 可以移动，版本号可以复用。
- **整批校验**：27 个里任何一个 frontmatter 非法（名字非 kebab-case、描述为空）就整次失败，
  不会悄悄变成 26 个。
- **失败不动现场**：下载、解压、校验阶段失败时 `active/` 一个字节都不改。
- **不重命名被监视的目录**：DSH 的 watcher 持有 `active/skills`，Windows 下改名会 EPERM，
  所以替换是"先把旧内容复制进 trash，再原地逐技能 reconcile"。
- **回滚只有一步**：`trash` 只保留上一版，回退后不能再回退。

## 测试

```powershell
node --test test/boot.test.mjs test/catalog.test.mjs test/sync.test.mjs
```

19 条，全部离线、用真 tar.gz 黄金样本（真 `tar.exe` 打的）与临时目录。

## 许可

插件代码 MIT。`skills/` 下是上游 MIT 内容，版权归 Matt Pocock，详见
`LICENSE-mattpocock-skills` 与 `THIRD-PARTY-NOTICES.md`。
