# Factory spec (exported)

> Source: private master plan v3.9 §3.1–§3.9, exported 2026-11-25.
> This is the only plan content the factory receives. Edit the source, then re-export; do not edit here.

### 3.1 设计原则：来自 OpenAI 和 Anthropic 的 12 条（详细内容见《Agent 交付方法》）
1. **能简单就简单**：流程明确的部分用确定性代码，需要灵活判断的部分才交给 agent。→ Coordinator 用脚本，只在步骤内部使用 agent。
2. **人掌舵，agent 执行**：agent 失败时，人去补它缺的能力（工具、护栏、文档），而不是替它干活或者让它再试一次。→ 每次升级都必须产出一个"改进框架"的 Issue。
3. **给 agent 地图，而不是手册**：AGENTS.md 约 100 行，指向 `docs/`；`docs/` 是唯一可信的知识来源。
4. **让应用对 agent 可见**：每个 worktree 都能启动应用；用浏览器做端到端验证，附截图。
5. **用机器强制架构规范和代码品味**：自定义 lint 规则加结构测试，报错信息里直接写修复方法。
6. **长任务的做法**：先初始化，生成功能清单（JSON，只有验证阶段能把功能标为通过）；每次只做一个功能；用进度文件加 git 记录状态。
7. **多 agent 要慎用**：写代码能并行的部分少；多 agent 消耗的 token 大约是普通对话的 15 倍。
8. **写操作单线程，上下文共享**：一个任务只有一个写入者；其他角色只读，只贡献判断。
9. **委派要写清楚**：目标、输出、工具、边界；投入的力度和任务的规模匹配（S/M/L）。
10. **评测要早、样本小也行**：约 20 个用例；用评分细则让 LLM 打分；看最终结果；人工测试不能少。
11. **护栏分层**：按风险分级；高风险或连续失败时转给人。
12. **持续清理"熵"**：写下"黄金原则"；后台 agent 定期清理，开小的修复 PR。

> **反例提醒**：OpenAI 团队之所以敢"门禁少、出问题往前修"，前提是产出远远超过人的注意力。我们处理的是个人数据，所以**隐私和安全路径保持严格的门禁**。

### 3.2 架构与仓库
```
~/ai-projects/                       ← 所有项目都在这里；这个目录本身不放 CLAUDE.md，也永远不整体挂载
├─ other-projects/                          已有项目；含 data/private；永远不挂载进容器
├─ agent-playbook/                   私有文档库（GitHub 私有仓库）；只在宿主机上用 Claude Code 维护（§3.10）
├─ agent-factory-container/          容器配置（Dockerfile、compose、防火墙、preflight）；只在宿主机运行，不挂载，agent 改不了；私有，暂不公开（ADR-0013）
└─ agent-factory/                    ← 唯一挂载进容器的目录（容器里是 /workspace），不含任何个人数据
   ├─ factory/        (GitHub: humyna-labs/factory)     工厂本身，版本号 v1.x
   │   ├─ roles/        researcher, initializer, designer, qa, builder, reviewer, compliance, gardener
   │   ├─ settings/     每个角色的 Claude Code 权限配置
   │   ├─ hooks/        path-guard（按角色拦截越权的写操作）、secret-guard
   │   ├─ coordinator/  TypeScript 状态机（确定性，有测试）
   │   ├─ bot/          Telegram 指令机器人（不经过 LLM）
   │   ├─ templates/product/   产品模板（Vite + React + TS + Zod + Playwright + CI + CODEOWNERS + factory.yaml）
   │   ├─ .github/workflows/gates.yml   可复用的门禁工作流（产品仓库通过 @v1 引用）
   │   ├─ evals/golden/ 工厂回归用的黄金任务
   │   └─ docs/         运行手册、ADR、黄金原则
   ├─ products/
   │   ├─ resume-sg/  (GitHub: humyna-labs/resume-sg)   P3
   │   └─ condo-demo/ (GitHub: humyna-labs/condo-demo)  W3 起
   └─ runs/           运行数据和轨迹（不进 git）

~/.config/agent-factory/factory.env  密钥（chmod 600）；在所有项目和挂载之外
```
> 以后的新项目也放在 `~/ai-projects/<项目名>/`。要让工厂开发的产品放在 `agent-factory/products/` 下；不需要 agent 的个人项目放在 `~/ai-projects/` 下与它们并列，默认不挂载。

**原生能力优先**：
- **Claude Code**：每个角色的约束全部用它自带的参数来实现：
  - `--append-system-prompt-file`：加载角色提示词；
  - `--settings`：加载该角色的权限配置；
  - `--disallowedTools`：收回不该有的工具；
  - `--model`：按角色选模型；
  - `--permission-mode auto`：dispatch 使用 auto 权限模式，不使用 `--dangerously-skip-permissions`（ADR-0007，D2 实施）；
  - `--max-turns`、`--max-budget-usd`：设置上限；
  - `-w`：在独立的 worktree 里工作；
  - `--output-format stream-json`：输出运行轨迹。
- **GitHub**：Issues 当任务板，标签当状态，用 rulesets、CODEOWNERS、可复用工作流做门禁。
- **Cloudflare**：Pages、Workers、KV；通过 Git 集成自动部署，**agent 拿不到任何 Cloudflare 凭证**。
- **需要自己写的只有三样**：Coordinator、Telegram 指令机器人、几个 hook。

### 3.3 角色库（同一套运行框架的不同配置）
| 角色 | 模型 | 运行时机 | 读写 | 产出 |
|---|---|---|---|---|
| Researcher | opus 或 sonnet | 启动时、需求变更时 | 只读，可以联网 | 领域和法规研究（附出处） |
| **Initializer**（PM + Architect） | opus | 启动时、每个里程碑 | 只写 `docs/`、`src/contracts/`、Issues | 需求文档、**`feature_list.json`**、ADR、契约、AGENTS.md 地图、任务图（每个任务 1–2 小时，标好风险等级）、`init.sh`、`progress.md` |
| Designer | sonnet | 启动时、做界面任务时 | 只写 `src/design/`、`src/templates/` | 设计规范、原创模板、截图 |
| QA / Eval | sonnet | 每个任务实现**之前** | 只写 `tests/`、`evals/` | 端到端测试、eval 用例（只用合成数据） |
| Builder | sonnet | 每个任务 | 只写 `src/`（契约、模板、安全目录除外）；**每个任务只有一个 Builder** | 实现代码 |
| Reviewer | **Codex**（只读沙箱） | 每个 PR | 只读 | 审查意见 |
| Compliance | haiku 或 sonnet | 每个 PR | 只读，可以运行扫描工具 | 合规报告 |
| Gardener | sonnet | 每晚 | 只开低风险的小 PR | 清理过时文档、修正偏差、打质量分 |
| **Coordinator**（脚本） | — | 一直运行 | — | 调度、状态、重试、升级、合并、记录运行数据 |

### 3.4 流程
```
产品简介（你写一页）
  → Researcher + Initializer → 需求、feature_list.json、任务图、设计稿截图
  → 【闸门 1：你一次性审批，附建议】
  → 每个任务：QA 写测试（先失败）→ Builder 在 worktree 里实现（/goal：让测试通过，不得修改测试）
       → Coordinator 独立重跑：类型检查、lint、单元测试、e2e（浏览器）、隐私 e2e、许可证、资源登记、密钥扫描
       → Reviewer（Codex）→ Compliance
       → 低风险：自动合并 → 自动部署 ；高风险：【闸门 2：你审批】
       → 失败：退回 Builder（最多 3 轮）→【闸门 3：升级给你】→ 自动生成"改进框架"的 Issue
  → 验证阶段把功能标为通过 → 所有功能都通过 = 里程碑完成
  → 【闸门 4：UAT】→【闸门 5：上线】
  → Gardener 每晚清理；早上推送摘要
```
**容错**：状态以 GitHub 上的标签为准，另有 JSONL 日志；所有操作都是幂等的，可以随时中断、随时续跑；全局并发上限初始为 3；用量接近订阅上限时自动降低并发。

### 3.5 降低人的瓶颈：七个机制
1. **批量决策**：需求、设计、任务图一次批完。
2. **按风险自动合并**：只有高风险路径找你（依赖、CSP 和安全头、加密、隐私代码、分享 Worker、CI、工厂配置、模板视觉）。
3. **Telegram 一键指令**：`/status`、`/digest`、`/approve <id>`、`/reject <id> <原因>`、`/pause`、`/resume`。只响应你的账号。
4. **高质量升级**：每次都附上背景、2–3 个选项和推荐方案，你回复编号就行。
5. **不阻塞**：等你回复的时候，工厂先做其他不相关的任务；长任务安排在夜里跑。
6. **看截图审视觉**：Designer 的产出自动截图，推送到手机。
7. **逐步放开**：某类改动连续 N 次合并都没出问题，就降一级（转为自动合并）；一旦出问题就收回。这些都记在 ADR 里。

### 3.6 安全基线（保护 Mac 和你的个人信息）
| 层 | 措施 |
|---|---|
| 宿主机 | 只把 `~/ai-projects/agent-factory` 挂载进容器，**绝不挂载 `~/ai-projects` 整个目录**，每次启动前由 `preflight.sh` 检查；**other personal projects、私有文档库和 `data/private` 永远不挂载**；容器配置放在不挂载的 `agent-factory-container/`；`~/ai-projects/` 根目录不放 `CLAUDE.md`（宿主机上的 Claude Code 会继承上级目录的 `CLAUDE.md`）；不挂载 `~/.ssh`、`~/.claude`、`docker.sock`；运行时用 `caffeinate` 防止休眠 |
| 容器 | 非 root 用户；出站白名单（Anthropic、GitHub、npm、Telegram、Codex 所需的域名）；启动时自检；固定 Claude Code 和 Codex CLI 的版本 |
| 身份 | agent 使用**机器账号**的细粒度 token：只授权指定的仓库，有 Contents 和 Pull requests 的写权限，**没有 Workflows 和 Administration 权限**；工厂仓库对 agent 只读；token 有效期 366 天，到期日写在 `~/.config/agent-factory/token-expiry.txt`，`preflight.sh` 提前 30 天提醒（ADR-0006） |
| 仓库规则 | main 分支：要求 PR、要求门禁全绿、高风险路径要求 code owner（你）审批、禁止强制推送。规则由你在**宿主机**上运行 `setup-repo.sh` 配置 |
| 部署 | Cloudflare 的 Git 集成，容器里没有 Cloudflare 凭证 |
| 通信 | 两个 Telegram 机器人都只允许你的账号；合并高风险 PR 只能在 GitHub 上操作（有两步验证），**不通过 Telegram** |
| 密钥 | 只放在环境变量里；gitleaks 扫描；仓库里永远不放密钥 |
| 私有文档库 | 放在 `~/ai-projects/agent-playbook`，不挂载进容器（个人计划和记录不让工厂 agent 看到）；不放密钥、证件号、简历原文；提交前钩子扫描密钥和个人信息；本地 Claude Code 只能读仓库内的文件，改不了护栏文件，推送要你确认 |

### 3.7 可维护性
- **版本**：工厂按语义化版本发布，产品固定引用 `factory@v1` 和 `gates.yml@v1`；有 CHANGELOG 和 ADR。
- **配置即代码**：`factory.yaml` 有 schema 校验；角色提示词是带版本的 Markdown。
- **工厂自己有测试**：状态机单元测试 + 用替身角色的集成测试 + **黄金任务 eval**。改动提示词或 Coordinator、升级 CLI 之前，必须先跑通黄金任务。
- **可观测**：`runs.csv`、JSONL 日志、`stream-json` 运行轨迹、每日摘要。
- **运行手册**：暂停和恢复、回滚、轮换 token、新增产品、新增角色或门禁。
- **元安全**：工厂的改动永远由你本人审查。

### 3.8 多产品与新想法的启动流程
1. 执行 `factory new-product <name>`：用模板生成仓库、标签、CODEOWNERS、`factory.yaml`；
2. 你在宿主机上执行 `setup-repo.sh`，配置仓库规则；
3. 写一页产品简介；
4. Researcher 和 Initializer 开始工作 → 闸门 1 → 流水线自动运行。

- **调度**：Coordinator 按全局并发上限和各产品的优先级排队。
- **瓶颈**：真正的限制是订阅的用量上限；先测出每周的消耗，再决定要不要升级档位。
- **经验跨产品复用**：各产品的失败模式汇总进工厂的 `failures.md` → 改进角色和门禁 → 跑黄金任务 → 发布新的工厂版本。

### 3.9 Telegram 远程操作
- **机器人 A（对话）**：Claude Code 官方的 Telegram 频道插件，在容器里的 tmux 会话中运行。用于下达意图、提问、查看进展。
  - **需要在 D1 验证**：这个插件要求 claude.ai 登录，要确认它在容器里的认证方式下能不能用。
- **机器人 B（指令）**：确定性的指令机器人，用于审批和推送摘要。
- **手机能做和不能做的**：手机上可以完成"提需求、看进展、审批普通事项"；**高风险合并在 GitHub App 上完成**。
