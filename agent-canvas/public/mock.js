// ════════════════════════════════════════════════════
// Mock 模式 — AI 生图多 Agent 协作演示
// 数据移植自 multi-agent-kanban.html，画布交互移植自 app.js
// ════════════════════════════════════════════════════

// ─── 主协调 Agent ────────────────────────────────────
const MAIN_AGENT = {
  name: '主协调 Agent',
  role: '需求拆解与分工规划 · 校验评估',
  avatar: 'M',
  model: 'claude-opus-4-6',
  color: '#7c3aed',
};

// ─── 5 个 Worker Agent ───────────────────────────────
const AGENTS = [
  {
    id: 'dataset-builder',
    name: '评测集构造',
    fullName: '评测集构造 Agent',
    role: '数据工程 · 类型规划',
    avatar: 'D',
    color: '#8b5cf6',
    model: 'claude-opus-4-6',
    status: 'done',
    progress: 100,
    branch: 'agent/dataset-builder',
    lastUpdate: '2小时前',
    skills: ['数据采样', '元数据设计', 'JSON Schema', '类型分布统计'],
    contextNeeds: ['业务需求文档', '商户数据样本', '图片类型分类标准', '历史评测集参考'],
    task: '按商品图（50%）、场景图（30%）、人物图（20%）的分布，从商户库采样并构造 2000 张评测集，包含完整元数据（商户ID、行业、图片类型、参考Prompt、期望效果描述）。',
    acceptance: '评测集覆盖三种图片类型，元数据完整率≥99%，类型分布误差≤2%，输出 evaluation_set_v1.jsonl',
    systemPrompt: '你是一位专业的 AI 评测数据工程师，擅长为生图模型构建高质量评测集。\n\n职责：\n1. 按指定类型分布（商品图50%/场景图30%/人物图20%）设计评测集结构\n2. 从商户数据库中采样有代表性的样本\n3. 为每条数据设计完整的元数据字段\n4. 确保评测集的多样性和代表性\n\n工作原则：\n- 类型分布严格遵守，误差不超过2%\n- 元数据完整率≥99%\n- 优先选择覆盖更多业务场景的样本\n- 输出格式严格遵循 evaluation_set_v1.jsonl 规范',
    claudeMd: '# 评测集构造 Agent\n\n## 项目背景\nAI 生图效果优化闭环，第一个环节。\n\n## 任务边界\n- 只负责评测集的构造，不参与图片生成\n- 输出文件：evaluation_set_v1.jsonl\n- 不得修改：src/image_gen/, src/quality_check/ 目录\n\n## 数据规范\n- 商品图 (product): 1000条\n- 场景图 (scene): 600条\n- 人物图 (portrait): 400条\n\n## 输出字段\nid / merchant_id / industry / image_type / ref_prompt / expected_desc / metadata\n\n## 验收标准\n- 总条数：2000\n- 完整率：≥ 99%\n- 类型误差：≤ 2%',
    conversations: [
      { role: 'user', text: '开始执行任务，按照文档中的类型分布构建 2000 张评测集。', time: '09:15' },
      { role: 'agent', text: '收到。先分析商户数据库现有分布：商品图相关商户 4,821 家、场景图 2,156 家、人物图 987 家。按目标分布 50/30/20 分别采样 1000/600/400 条，开始执行采样逻辑...', time: '09:16' },
      { role: 'agent', text: '采样完成，元数据补全检查：商品图 1000 条完整率 99.7%；场景图 600 条 99.5%；人物图 400 条 97.3%（23 条缺少"人物类型"字段，已按行业标签+EXIF 推断，4 条标记 unknown 供人工确认）。', time: '09:23' },
      { role: 'agent', text: '✅ 评测集构造完成！输出 evaluation_set_v1.jsonl（2000条），总体元数据完整率 99.6%，类型分布误差 0.3%，ambiguous 样本 4 条（附 ambiguous_list.json）。任务完成，等待验收。', time: '10:02' },
    ],
    prNum: 'PR #47',
    prStatus: 'done',
    prTitle: '评测集构造：2000条评测数据（商品/场景/人物）',
    issues: [],
    alert: false,
  },
  {
    id: 'image-generator',
    name: '图片生成',
    fullName: '图片生成 Agent',
    role: '模型调用 · 批处理',
    avatar: 'G',
    color: '#3b82f6',
    model: 'claude-sonnet-4-6',
    status: 'running',
    progress: 70,
    branch: 'agent/image-generator',
    lastUpdate: '12分钟前',
    skills: ['LongCat API', 'Prompt 管理', '批处理调度', '错误重试', '版本记录'],
    contextNeeds: ['evaluation_set_v1.jsonl', 'LongCat API 文档', 'Prompt 模板库 v3', '生成配额限制'],
    task: '读取评测集，调用 LongCat 生图 API 批量生成 2000 张图片，管理 Prompt 版本记录和生成结果元数据，确保每张图片有完整生成日志。',
    acceptance: '生成成功率≥95%，所有成功生成图片有完整元数据，输出 generation_results_v1.jsonl，Prompt 版本记录到 prompt_log.json',
    systemPrompt: '你是一位专业的 AI 生图工程师，负责管理 LongCat 模型的批量生图任务。\n\n职责：\n1. 读取评测集，对每条数据构造生图 Prompt\n2. 合理管理 API 调用频率，避免超额限制\n3. 处理生成失败（重试 3 次后标记失败）\n4. 记录完整的生成元数据和 Prompt 版本\n\n工作原则：\n- Prompt 构造遵循 Prompt 模板库 v3 规范\n- 生成失败需详细记录原因\n- 每批次生成后立即写入结果，防止数据丢失',
    claudeMd: '# 图片生成 Agent\n\n## 任务边界\n- 输入：evaluation_set_v1.jsonl（来自评测集构造 Agent）\n- 输出：generation_results_v1.jsonl, prompt_log.json\n- 不得修改：src/dataset/, src/quality_check/ 目录\n\n## API 调用规范\n- 并发数：≤ 10\n- 重试策略：3次，退避间隔 2/4/8s\n- 超时：30s/张\n\n## Prompt 构造规范\n基于 prompt_template_v3.json，变量注入：merchant_context / image_type / quality_requirements\n\n## 进度追踪\n每完成 100 张写入 generation_progress.json',
    conversations: [
      { role: 'user', text: '评测集已就绪，开始批量生图。', time: '10:15' },
      { role: 'agent', text: '收到！读取评测集 2000 条。批次规划：商品图 20批×50、场景图 12批×50、人物图 8批×50。预计总耗时约 4 小时（API 限速 10 并发）。开始执行...', time: '10:16' },
      { role: 'agent', text: '进度：商品图 1000/1000 完成（成功率 98.2%）；场景图 320/600 进行中（64%）；人物图等待中。累计 1320 张，平均 4.2s/张。', time: '13:30' },
      { role: 'user', text: '场景图速度有点慢，可以提高并发吗？', time: '13:32' },
      { role: 'agent', text: '当前并发 10，受 LongCat API 限速（QPS=12）已接近上限。可提到 12 但有限速风险，建议优先调度场景图剩余批次，预计省 15 分钟。是否调整？', time: '13:33' },
      { role: 'agent', text: '⚠️ API 限速触发！batch_038 收到 HTTP 429。已触发退避（暂停 8s 重试），并发临时降回 10，受影响 12 张加入重试队列。预计延迟约 3 分钟。', time: '13:51' },
      { role: 'agent', text: '当前累计 1880/2000，成功率 97.1%，平均 4.6s/张。继续执行中。', time: '14:02' },
    ],
    prNum: null,
    prStatus: 'running',
    prTitle: null,
    issues: ['并发调整触发 API 限速警告', '74 张失败（3.7%）其中 28 张 Prompt 结构异常'],
    alert: true,
  },
  {
    id: 'quality-checker',
    name: '图片质检',
    fullName: '图片质检 Agent',
    role: '多维质检 · 流式输出',
    avatar: 'Q',
    color: '#f59e0b',
    model: 'claude-opus-4-6',
    status: 'review',
    progress: 95,
    branch: 'agent/quality-checker',
    lastUpdate: '38分钟前',
    skills: ['视觉理解', '文字识别', '品牌一致性检测', '批量分析', '流式推送'],
    contextNeeds: ['generation_results_v1.jsonl', '质检标准文档 v2', '商户品牌资产库', '评测集元数据'],
    task: '对生成图片进行三维度质检：文字正确性、画面可用性（构图/清晰度/主体完整）、商户品牌一致性（色系/LOGO/风格）。每完成 100 张流式推送给 RCA Agent。',
    acceptance: '质检覆盖率100%，每张图有完整评分（0-10），badcase 列表完整，输出 quality_report_v1.json',
    systemPrompt: '你是一位专业的 AI 生图质量检验工程师，专注商业图片多维度质量评估。\n\n质检维度：\n1. 文字正确性（权重30%）：错字/乱码/截断\n2. 画面可用性（权重40%）：构图/清晰度/主体完整/美观\n3. 品牌一致性（权重30%）：色调/LOGO/品牌风格\n\n输出：每张图三维评分+综合评分，综合<6 标记 badcase，每100张流式推送 RCA Agent。',
    claudeMd: '# 图片质检 Agent\n\n## 任务边界\n- 输入：generation_results_v1.jsonl（来自图片生成 Agent）\n- 输出：quality_report_v1.json（流式推送 + 最终报告）\n- 不得修改：src/dataset/, src/image_gen/ 目录\n\n## 质检标准\n| 维度 | 权重 | 合格线 |\n|------|------|--------|\n| 文字正确性 | 30% | ≥ 7 |\n| 画面可用性 | 40% | ≥ 6 |\n| 品牌一致性 | 30% | ≥ 6 |\n综合 < 6 → badcase\n\n## 流式输出协议\n每完成100张推送到 rca_agent_inbox/batch_{n}.json\n\n## 完成条件\n覆盖率 100%，badcase 列表完整，输出 quality_report_v1.json',
    conversations: [
      { role: 'user', text: '开始对已生成图片执行质检，需流式输出给 RCA Agent。', time: '11:00' },
      { role: 'agent', text: '收到，已接入 generation_results_v1.jsonl。启动三维质检流程，同时建立到 RCA Agent 的流式推送通道。', time: '11:01' },
      { role: 'agent', text: '第1批（0-100张）完成：文字问题 8 张、画面问题 12 张、品牌问题 5 张，badcase 15 张（15%），已推送 RCA Agent。', time: '11:18' },
      { role: 'agent', text: '批次进度（16/20完成，1600张）：整体 badcase 率 11.3%，主要聚集在场景图文字截断（占 badcase 43%）。', time: '13:45' },
      { role: 'user', text: '场景图文字截断比例很高，输出典型样例。', time: '13:47' },
      { role: 'agent', text: '已汇总场景图文字截断 top10 样例，关键特征：①长文字(>12字)在宽幅图频繁截断 ②文字与背景对比度低 ③文字位于边缘1/4区域截断率最高。3 条规律已同步 RCA Agent。', time: '13:50' },
      { role: 'agent', text: '✅ 全部 1900 张质检完成！合格 1687（88.8%），badcase 213（11.2%）。主要问题：场景图文字截断 87、人物图品牌色偏差 63、商品图主体不清晰 41。输出 quality_report_v1.json，等待主 Agent 验收。', time: '15:30' },
    ],
    prNum: 'PR #52',
    prStatus: 'review',
    prTitle: '图片质检报告：1900张，badcase率11.2%，流式结果已推送',
    issues: ['场景图文字截断率偏高（22%）', '等待图片生成 Agent 剩余 100 张'],
    alert: true,
  },
  {
    id: 'rca-analyst',
    name: '根因分析',
    fullName: '根因分析 Agent',
    role: 'RCA 分析 · 实时接收',
    avatar: 'R',
    color: '#ef4444',
    model: 'claude-opus-4-6',
    status: 'running',
    progress: 35,
    branch: 'agent/rca-analyst',
    lastUpdate: '5分钟前',
    skills: ['根因分析', '统计分析', 'Prompt 归因', '模式识别', '报告生成'],
    contextNeeds: ['quality_report_v1.json（流式）', '历史 Prompt 版本记录', 'LongCat 模型变更日志', '商户类型分类'],
    task: '实时接收质检 Agent 的流式输出，对 badcase 进行根因归因（Prompt 设计/模型能力边界/数据问题/商户特异性），输出根因分类报告供提示词调优 Agent 使用。',
    acceptance: '覆盖所有 badcase，根因分类准确率≥80%（人工抽检），输出 rca_report_v1.json，含问题优先级排序',
    systemPrompt: '你是一位专业的 AI 效果根因分析师，擅长从生图质检结果中定位深层原因。\n\n根因分类框架：\n1. P类（Prompt设计问题）：描述不准、缺约束、格式不符\n2. M类（模型能力边界）：模型本身局限，非 Prompt 可改善\n3. D类（数据质量问题）：评测集参考描述有误\n4. S类（商户特异性）：特定商户/行业特殊需求\n\n工作方式：实时接收流式推送，每批更新累计统计，最终输出按优先级排序的根因报告。',
    claudeMd: '# 根因分析 Agent\n\n## 任务边界\n- 输入：rca_agent_inbox/（质检 Agent 流式推送）\n- 输出：rca_report_v1.json\n- 不得修改：src/dataset/, src/image_gen/, src/quality_check/ 目录\n\n## 根因分类\n- P类（Prompt问题）：可调优提示词改善\n- M类（模型问题）：需模型侧介入，记录不处理\n- D类（数据问题）：反馈给评测集构造 Agent\n- S类（商户特异性）：需商户定制化策略\n\n## 优先级原则\nP类问题优先分析并输出 → 提示词调优 Agent 使用\n\n## 输出格式\nrca_report_v1.json：summary / p_class_issues / recommendations',
    conversations: [
      { role: 'agent', text: '已建立与质检 Agent 的流式接收通道，开始实时分析 badcase。', time: '11:05' },
      { role: 'agent', text: '第1批分析完成（15 个 badcase）：P类 9（60%）、M类 3（20%）、D类 2（13%）、S类 1（7%）。P类主要表现：文字长度未约束、场景描述过于抽象。', time: '11:22' },
      { role: 'agent', text: '累计 8 批（约 800 维度）：P类凸显三个模式——①文字 Prompt 缺字符数上限约束 ②品牌色用自然语言而非色值 ③人物图缺背景简洁度约束。已生成初步调优建议准备推送。', time: '14:00' },
      { role: 'user', text: 'P类比例这么高，是 Prompt 模板的系统性问题吗？', time: '14:05' },
      { role: 'agent', text: '是系统性问题。v3 模板三个共性缺陷：①缺元素尺寸/数量约束 ②颜色描述标准不统一 ③负向约束多于正向约束。这 3 个问题导致约 65% badcase，是 v4 重点改进方向。', time: '14:07' },
      { role: 'agent', text: 'P类详细拆解（127 个 P类 badcase）：P-001 文字长度未约束 41例(32%)、P-002 品牌色自然语言 33例(26%)、P-003 人物背景未约束简洁度 29例(23%)、P-004 构图优先级歧义 24例(19%)。均可改 prompt_template_v3.json 修复，预计改善 70-80%。', time: '14:15' },
      { role: 'agent', text: '✅ 初步 RCA 报告已推送提示词调优 Agent（rca_preliminary_for_tuner.json）：高优先级修复 4 项（max_text_chars=8 / brand_color 改 HEX / portrait 加 background_simplicity / scene focal_point 必填），目标 P类 badcase 率 11.8%→<5%。全量报告待质检剩余 26 张后输出。', time: '14:35' },
    ],
    prNum: null,
    prStatus: 'running',
    prTitle: null,
    issues: ['依赖质检 Agent 全量完成', '当前分析覆盖率仅 35%'],
    alert: false,
  },
  {
    id: 'prompt-tuner',
    name: '提示词调优',
    fullName: '提示词调优 Agent',
    role: 'Prompt 优化 · 版本管理',
    avatar: 'T',
    color: '#10b981',
    model: 'claude-sonnet-4-6',
    status: 'pending',
    progress: 0,
    branch: 'agent/prompt-tuner',
    lastUpdate: '未启动',
    skills: ['Prompt Engineering', 'A/B测试设计', '版本管理', '效果评估', '模板生成'],
    contextNeeds: ['rca_report_v1.json', 'Prompt 模板库 v3', 'A/B 测试框架文档', '历史调优记录'],
    task: '基于 RCA 分析报告，对现有 Prompt 模板进行针对性优化，输出 Prompt 模板 v4，并设计 A/B 测试方案验证优化效果。',
    acceptance: '输出 prompt_template_v4.json，A/B 测试方案文档，预期改善 P类 badcase 率≥40%',
    systemPrompt: '你是一位专业的 AI Prompt 工程师，专注生图模型提示词优化。\n\n工作方式：\n1. 深度分析 RCA 报告，理解每类 P类问题根因\n2. 针对性修改 Prompt 模板，而非全量重写\n3. 每次修改附理由和预期改善方向\n4. 设计 A/B 测试方案确保可验证\n\n优化原则：\n- 精准定向修改，避免过度修改引入新问题\n- 保留原有有效结构\n- 新增约束用正向描述（must contain）\n- 颜色描述统一 HEX/RGB 格式',
    claudeMd: '# 提示词调优 Agent\n\n## 任务边界\n- 输入：rca_report_v1.json（来自 RCA Agent）\n- 输出：prompt_template_v4.json, ab_test_plan.md\n- 不得修改：src/dataset/, src/image_gen/, src/quality_check/, src/rca/ 目录\n\n## 调优原则\n1. 针对 P类问题逐条修复\n2. 每个修改项注明对应 RCA 问题 ID\n3. 保留 v3 模板有效结构\n\n## 版本管理\nprompt_template_v4.json：完整模板内容 + 与 v3 变更列表 + 每个变更预期改善方向\n\n## 等待条件\n需等待 rca_report_v1.json 完成后才能启动',
    conversations: [
      { role: 'agent', text: '⏸ 等待依赖项完成。依赖：rca_report_v1.json（RCA Agent 完成率 35%，预计 ~2.5 小时）。已做准备：读取 Prompt 模板库 v3（47 个模板）、分析历史调优记录 v1→v2→v3、准备 A/B 测试框架模板。', time: '14:36' },
      { role: 'agent', text: '📋 预执行规划（基于 RCA 实时推送初步结论）：阶段1(30min) P类定向修复——P-001 注入 max_text_chars、P-002 brand_color 改 HEX 强校验、P-003 portrait 加 background_simplicity 枚举、P-004 scene focal_point 强制非空；阶段2(20min) 生成 v4 模板+diff；阶段3(15min) A/B 方案（实验组 v4 对照组 v3，各 200 张，目标 P类 badcase 11.8%→<5%）。预计总耗时 ~65 分钟，等待 RCA 完成即启动。', time: '14:38' },
    ],
    prNum: null,
    prStatus: 'pending',
    prTitle: null,
    issues: ['等待 RCA Agent 完成分析'],
    alert: false,
  },
];

// ─── 主 Agent 需求沟通脚本 ────────────────────────────
const MAIN_CHAT_SCRIPT = [
  { role: 'agent', text: '你好！我是主协调 Agent，负责帮你将复杂项目需求拆解成多个 Agent 可执行的分工方案。\n\n请描述你的项目目标，我会基于项目上下文为你生成一份完整的 Agent 分工方案。', time: '14:02', taskReveal: [] },
  { role: 'user', text: '我想做一个 AI 生图效果优化的完整工作流，需要覆盖评测集构造、图片生成、质检、RCA 根因分析和提示词调优几个环节，形成一个持续优化的闭环。', time: '14:03' },
  { role: 'agent', text: '这是一个典型的 AI 能力评测与优化闭环，涉及多个专业领域，非常适合多 Agent 协作。\n\n在正式拆分前需要了解几个关键信息：\n• 使用的生图模型是什么？（影响提示词策略）\n• 评测集规模大概多少？（影响质检批处理设计）\n• 质检核心维度有哪些？（文字、构图、风格、商户一致性等）\n• 是否需要多轮迭代？', time: '14:04', taskReveal: [] },
  { role: 'user', text: '模型是内部的 LongCat，评测集大概 2000 张，分商品图、场景图、人物图三种类型。质检需检查文字正确性、画面可用性、商户品牌一致性。需要支持多轮迭代优化。', time: '14:05' },
  { role: 'agent', text: '明白了。基于你的需求，设计以下 5 Agent 分工方案，每个负责闭环内一个专项环节：\n\n① 评测集构造 Agent — 按商品/场景/人物设计 2000 张评测集类型分布与元数据\n② 图片生成 Agent — 调用 LongCat API 批量生成，管理 Prompt 版本与生成记录\n③ 图片质检 Agent — 多维度自动质检（文字/可用性/品牌一致性）+ badcase 标注\n④ RCA 根因分析 Agent — 分析质检失败原因，定位 Prompt/模型/数据问题\n⑤ 提示词调优 Agent — 基于 RCA 输出优化 Prompt，支持 A/B 版本管理\n\n依赖关系：①→②→③→④→⑤→②（循环优化）。这个方案如何？', time: '14:07', taskReveal: [0,1,2,3,4] },
  { role: 'user', text: '方案很好，但 RCA Agent 需要和质检 Agent 更紧密协作，质检中间数据应直接流向 RCA，不要等质检全部完成。', time: '14:09' },
  { role: 'agent', text: '收到！更新 ③ 和 ④ 的协作：质检 Agent 采用流式输出，每完成一批（100张）将 badcase 列表和初步统计实时推送给 RCA Agent，可提前开始分析，不必等全部 2000 张完成。预计节省约 40% 等待时间，让 RCA 结论更早指导提示词调优。\n\n分工方案已更新，可确认并进入执行阶段。', time: '14:10', taskReveal: [] },
  { role: 'user', text: '好，确认这个方案。', time: '14:11' },
  { role: 'agent', text: '✅ 分工方案已确认，共 5 个专项 Agent。已为每个 Agent 生成：任务描述与验收标准、所需上下文清单、建议模型与工具、Git 分支隔离策略。\n\n点击「确认方案 → 进入执行」即可启动各 Agent 执行。', time: '14:11', taskReveal: [] },
];

// ─── 校验评估脚本 ────────────────────────────────────
const VERIFY_CHAT_SCRIPT = [
  { role: 'agent', text: '所有 Agent 任务已进入验收阶段，我来对各 Agent 产出做整体评估。\n\n初步结论：\n• ✅ 评测集构造（#1）：完全符合验收标准\n• ⚠️ 图片生成（#2）：成功率 96.3%，略低于预期但可接受，并发调整需记录\n• ⚠️ 图片质检（#3）：场景图 badcase 率偏高（22%），需关注\n• 🔄 根因分析（#4）：仍在进行，等待全量数据\n• ⏳ 提示词调优（#5）：未启动，依赖 #4\n\n主要风险点是 #3 发现的场景图文字截断问题，直接影响后续调优效果。', time: '15:45' },
  { role: 'user', text: '你觉得哪个 Agent 的产出问题最严重？具体说明。', time: '15:47' },
  { role: 'agent', text: '从对下一轮优化循环的影响看，问题最严重的是图片生成 Agent（#2）。\n\n表面上看 #3 的 11.2% badcase 率更显眼，但质检只是"发现问题"环节，本身产出完整。\n\n#2 的问题更根本：\n1. 74 张彻底失败（3次重试放弃），这些在质检和 RCA 中都没覆盖，是评测盲区\n2. 失败中 28 张是"Prompt 结构异常"——LongCat API 对 v3 模板某些字段组合解析有问题，而 RCA 无法覆盖（无生成结果可分析）\n3. API 限速触发 batch_038 中断，并发策略有隐患，下一轮 2000 张同样会触发\n\n量化影响：质检覆盖率实际 96.3%（非设计 100%）；RCA 基于 badcase 缺失 3-5%，根因结论有偏差风险；不修限速，v4 的 A/B 验证同样被污染。', time: '15:49' },
  { role: 'user', text: '好，那下一轮优化循环的行动计划是什么？', time: '15:51' },
  { role: 'agent', text: '下一轮行动计划（按优先级）：\n\n【立即处理】\n① 等 RCA Agent 输出 rca_report_v1.json（~1h）\n② 图片生成 Agent 补生成 74 张失败图片（排查 28 张 Prompt 结构异常）\n\n【第二轮核心】\n③ 提示词调优 Agent 输出 prompt_template_v4.json（重点修 P-001~P-004，目标 P类 badcase 11.8%→<5%）\n④ 图片生成 Agent 修复 API 调用策略：并发回 10、加 QPS 监控动态退避、Prompt 结构异常追加格式校验前置\n\n【验证轮次】\n⑤ v4 模板对 200 张 A/B 生图对比\n⑥ 质检对比两组，目标 v4 整体 badcase <7%、场景图文字截断 <5%\n\n预计 ~5 小时，完成后进入第二轮闭环验收。', time: '15:53' },
];

// ════════════════════════════════════════════════════
// 画布交互 (移植自 app.js)
// ════════════════════════════════════════════════════
let camera = { x: 40, y: 40, scale: 1 };
let isPanning = false, panStart = { mx: 0, my: 0, cx: 0, cy: 0 };
let zoomHideTimer = null;

function applyTransform() {
  document.getElementById('canvas').style.transform =
    `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
}
function screenToWorld(sx, sy) {
  const rect = document.getElementById('canvas-container').getBoundingClientRect();
  return { x: (sx - rect.left - camera.x) / camera.scale, y: (sy - rect.top - camera.y) / camera.scale };
}
function showZoomBadge() {
  const el = document.getElementById('zoom-indicator');
  el.textContent = Math.round(camera.scale * 100) + '%';
  el.classList.add('visible');
  clearTimeout(zoomHideTimer);
  zoomHideTimer = setTimeout(() => el.classList.remove('visible'), 1400);
}
function resetView() { camera = { x: 40, y: 40, scale: 1 }; applyTransform(); showZoomBadge(); }

const container = document.getElementById('canvas-container');
container.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  closeWorkerPanel(); closeMainPanel();
  isPanning = true;
  panStart = { mx: e.clientX, my: e.clientY, cx: camera.x, cy: camera.y };
  container.classList.add('panning');
  e.preventDefault();
});
document.addEventListener('mousemove', e => {
  if (!isPanning) return;
  camera.x = panStart.cx + (e.clientX - panStart.mx);
  camera.y = panStart.cy + (e.clientY - panStart.my);
  applyTransform();
});
document.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false; container.classList.remove('panning');
});
container.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = container.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const ns = Math.min(3, Math.max(0.15, camera.scale * Math.pow(1.001, -e.deltaY)));
  camera.x = mx - (mx - camera.x) * (ns / camera.scale);
  camera.y = my - (my - camera.y) * (ns / camera.scale);
  camera.scale = ns;
  applyTransform(); showZoomBadge();
}, { passive: false });

document.getElementById('btn-reset-view').addEventListener('click', resetView);

// ════════════════════════════════════════════════════
// 状态配置
// ════════════════════════════════════════════════════
const statusConfig = {
  done:    { label: '已完成', color: '#10b981', badgeClass: 'badge-done' },
  running: { label: '进行中', color: '#3b82f6', badgeClass: 'badge-running' },
  review:  { label: '待验收', color: '#f59e0b', badgeClass: 'badge-review' },
  pending: { label: '待开始', color: '#6e7681', badgeClass: 'badge-pending' },
  paused:  { label: '已暂停', color: '#8b949e', badgeClass: 'badge-paused' },
};

// 卡片布局位置 (画布世界坐标)
const LAYOUT = {
  main: { x: 60, y: 120 },
  workspace: { x: 380, y: 60, w: 1480, h: 320 },
  workers: [
    { x: 410,  y: 110 },  // 评测集构造
    { x: 700,  y: 110 },  // 图片生成
    { x: 990,  y: 110 },  // 图片质检
    { x: 1280, y: 110 },  // RCA
    { x: 1570, y: 110 },  // 提示词调优
  ],
};

let currentAgentId = null;
let currentTab = 'task';
let phase = 'chat'; // chat | exec | verify

// ════════════════════════════════════════════════════
// 渲染卡片
// ════════════════════════════════════════════════════
function renderCanvas() {
  const canvas = document.getElementById('canvas');
  canvas.innerHTML = '';

  // workspace 容器
  const ws = document.createElement('div');
  ws.className = 'mock-workspace';
  ws.style.cssText = `left:${LAYOUT.workspace.x}px;top:${LAYOUT.workspace.y}px;width:${LAYOUT.workspace.w}px;height:${LAYOUT.workspace.h}px`;
  ws.innerHTML = `<div class="mock-workspace-label">离线评测闭环 · ①→②→③→④→⑤→②</div>`;
  canvas.appendChild(ws);

  // 主 Agent 卡片
  canvas.appendChild(buildMainCard());

  // worker 卡片
  AGENTS.forEach((a, i) => {
    const pos = LAYOUT.workers[i];
    canvas.appendChild(buildWorkerCard(a, pos));
  });
}

function buildMainCard() {
  const el = document.createElement('div');
  el.className = 'mock-main-card';
  el.style.cssText = `left:${LAYOUT.main.x}px;top:${LAYOUT.main.y}px`;
  el.innerHTML = `
    <div class="mc-head">
      <div class="mc-avatar">${MAIN_AGENT.avatar}</div>
      <div>
        <div class="mc-title">${esc(MAIN_AGENT.name)}</div>
        <div class="mc-role">${esc(MAIN_AGENT.role)}</div>
      </div>
    </div>
    <div class="mc-body">
      <span class="mc-tag">★ 协调中枢</span>
      <div style="font-size:11.5px;color:var(--text2);line-height:1.6">负责需求沟通、分工拆解、以及最终校验评估，定位问题 Agent 并规划下一轮优化。</div>
      <div class="mc-hint">点击进入对话 →</div>
    </div>`;
  el.addEventListener('click', () => openMainPanel());
  return el;
}

function buildWorkerCard(a, pos) {
  const cfg = statusConfig[a.status] || statusConfig.pending;
  const el = document.createElement('div');
  el.className = 'mock-agent-card';
  el.dataset.id = a.id;
  el.style.cssText = `left:${pos.x}px;top:${pos.y}px`;
  el.innerHTML = `
    ${a.alert ? `<div class="mac-alert">!</div>` : ''}
    <div class="mac-head">
      <div class="mac-avatar" style="background:${a.color}22;color:${a.color}">${a.avatar}</div>
      <div class="mac-info">
        <div class="mac-name">${esc(a.fullName)}</div>
        <div class="mac-role">${esc(a.role)}</div>
      </div>
    </div>
    <div class="mac-body">
      <div class="mac-progress">
        <div class="mac-progress-meta">
          <span class="mpm-label">${cfg.label}</span>
          <span class="mpm-pct">${a.progress}%</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar" style="width:${a.progress}%;background:${cfg.color}"></div>
        </div>
      </div>
      <div class="mac-footer">
        <span class="model-badge">${esc(a.model.split('-').slice(-2).join('-'))}</span>
        ${a.skills.slice(0,2).map(s => `<span class="skill-chip">${esc(s)}</span>`).join('')}
      </div>
      <div class="mac-click-hint">点击进入对话 →</div>
    </div>`;
  el.addEventListener('click', () => openWorkerPanel(a.id));
  return el;
}

// ════════════════════════════════════════════════════
// Worker Agent 面板
// ════════════════════════════════════════════════════
function openWorkerPanel(id) {
  const a = AGENTS.find(x => x.id === id);
  if (!a) return;
  currentAgentId = id;
  currentTab = 'task';
  closeMainPanel();

  document.querySelectorAll('.mock-agent-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
  document.getElementById('mph-avatar').textContent = a.avatar;
  document.getElementById('mph-avatar').style.background = a.color + '33';
  document.getElementById('mph-avatar').style.color = a.color;
  document.getElementById('mph-name').textContent = a.fullName;
  document.getElementById('mph-role').textContent = a.role;
  updateWorkerBadge(a);

  document.querySelectorAll('#mock-agent-panel .panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'task'));
  renderPanelTab('task', a);
  renderSteerButtons(a);
  document.getElementById('mock-agent-panel').classList.add('open');
}

function closeWorkerPanel() {
  document.getElementById('mock-agent-panel').classList.remove('open');
  document.querySelectorAll('.mock-agent-card').forEach(c => c.classList.remove('selected'));
  currentAgentId = null;
}

function updateWorkerBadge(a) {
  const cfg = statusConfig[a.status] || statusConfig.pending;
  const b = document.getElementById('mph-badge');
  b.className = 'status-badge ' + cfg.badgeClass;
  b.textContent = '● ' + cfg.label;
}

function renderSteerButtons(a) {
  document.getElementById('steer-buttons').innerHTML = `
    <span style="font-size:11px;color:var(--text3);padding:2px 4px">快捷引导：</span>
    <div class="steer-btn" data-steer="加快进度">⚡ 加快进度</div>
    <div class="steer-btn" data-steer="输出当前进展摘要">📊 进展摘要</div>
    <div class="steer-btn" data-steer="暂停并等待确认">⏸ 暂停</div>
    <div class="steer-btn" data-steer="列出当前遇到的问题">❗ 问题列表</div>`;
  document.querySelectorAll('#steer-buttons .steer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.steer;
      const ta = document.getElementById('mock-chat-textarea');
      ta.value = text;
      sendWorkerMsg();
      // 切到对话记录 tab
      switchTab('convo');
    });
  });
}

function switchTab(tab) {
  currentTab = tab;
  const a = AGENTS.find(x => x.id === currentAgentId);
  if (!a) return;
  document.querySelectorAll('#mock-agent-panel .panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderPanelTab(tab, a);
}

document.querySelectorAll('#mock-agent-panel .panel-tab').forEach(t => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

document.getElementById('mph-close-btn').addEventListener('click', closeWorkerPanel);

function renderPanelTab(tab, a) {
  const body = document.getElementById('mock-panel-body');
  const cfg = statusConfig[a.status] || statusConfig.pending;

  if (tab === 'task') {
    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-section-title">任务状态</div>
        <div class="info-row"><span class="label">状态</span><span class="status-badge ${cfg.badgeClass}">${cfg.label}</span></div>
        <div class="info-row"><span class="label">进度</span><div style="flex:1"><div class="progress-bar-wrap"><div class="progress-bar" style="width:${a.progress}%;background:${cfg.color}"></div></div></div><span style="font-size:12px;margin-left:8px">${a.progress}%</span></div>
        <div class="info-row"><span class="label">分支</span><span class="value" style="font-family:'Menlo',monospace;font-size:12px">${esc(a.branch)}</span></div>
        <div class="info-row"><span class="label">最近更新</span><span class="value">${esc(a.lastUpdate)}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">任务描述</div>
        <div class="section-text">${esc(a.task)}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">验收标准</div>
        <div class="section-text">${esc(a.acceptance)}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">所需上下文</div>
        ${a.contextNeeds.map(c => `<div class="info-row" style="gap:6px"><span style="color:var(--text3)">•</span><span style="font-size:12.5px;color:var(--text2)">${esc(c)}</span></div>`).join('')}
      </div>
      ${a.issues.length ? `<div class="panel-section"><div class="panel-section-title">当前问题</div>${a.issues.map(i => `<div class="issue-item"><span>⚠</span><span>${esc(i)}</span></div>`).join('')}</div>` : ''}
    `;
  } else if (tab === 'convo') {
    if (!a.conversations.length) {
      body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px">Agent 尚未启动，暂无对话记录</div>`;
      return;
    }
    body.innerHTML = `<div class="panel-convo" id="panel-convo">${a.conversations.map(c => `
      <div class="panel-msg ${c.role}">
        <div class="msg-role">${c.role === 'user' ? '👤 用户' : '🤖 ' + a.name + ' Agent'} · ${c.time}</div>
        <div class="msg-text">${esc(c.text)}</div>
      </div>`).join('')}</div>`;
    body.scrollTop = body.scrollHeight;
  } else if (tab === 'claude') {
    body.innerHTML = `<div class="panel-section"><div class="panel-section-title">Claude.md 内容</div><pre class="code-block">${esc(a.claudeMd)}</pre></div>`;
  } else if (tab === 'system') {
    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-section-title">系统提示词 (人设)</div>
        <div class="section-text">${esc(a.systemPrompt)}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">模型配置</div>
        <div class="info-row"><span class="label">模型</span><span class="tag">${esc(a.model)}</span></div>
        <div class="info-row"><span class="label">Temperature</span><span class="value">0.3</span></div>
        <div class="info-row"><span class="label">Max tokens</span><span class="value">8192</span></div>
        <div class="info-row"><span class="label">工具</span><span class="value">${esc(a.skills.slice(0,2).join('、'))} 等</span></div>
      </div>`;
  } else if (tab === 'tools') {
    body.innerHTML = `
      <div class="panel-section">
        <div class="panel-section-title">工具箱 (Skills / 固定工作流)</div>
        <div class="skill-tags" style="margin-top:4px">${a.skills.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">技能说明</div>
        ${a.skills.map(s => `<div class="info-row" style="gap:8px"><span style="color:${a.color}">▸</span><span style="font-size:12.5px;color:var(--text2)"><b style="color:var(--text)">${esc(s)}</b> — ${esc(skillDesc(s))}</span></div>`).join('')}
      </div>`;
  }
}

function skillDesc(s) {
  const m = {
    '数据采样': '从商户库按类型分布抽样', '元数据设计': '定义字段结构与规范', 'JSON Schema': '校验输出格式合法性', '类型分布统计': '核对配比误差',
    'LongCat API': '调用内部生图模型接口', 'Prompt 管理': '版本化维护 Prompt 模板', '批处理调度': '并发与队列控制', '错误重试': '退避重试与失败标记', '版本记录': '生成日志与 diff',
    '视觉理解': '识别画面主体与构图', '文字识别': 'OCR 检测错字/截断', '品牌一致性检测': '比对色系/LOGO', '批量分析': '大规模图片并行质检', '流式推送': '增量结果实时下发',
    '根因分析': 'P/M/D/S 四类归因', '统计分析': 'badcase 分布量化', 'Prompt 归因': '定位模板缺陷', '模式识别': '发现共性失败规律', '报告生成': '输出 RCA 报告',
    'Prompt Engineering': '提示词工程改写', 'A/B测试设计': '对照实验方案', '版本管理': 'v3→v4 diff', '效果评估': '指标对比验证', '模板生成': '产出新模板文件',
  };
  return m[s] || '可用工具';
}

// ════════════════════════════════════════════════════
// 轻量 Mock 引擎
// ════════════════════════════════════════════════════
function mockReply(agent, input) {
  const t = input.toLowerCase();
  const cfg = statusConfig[agent.status] || statusConfig.pending;
  let text = '';

  if (/进度|进展|摘要/.test(t)) {
    text = `当前进度 ${agent.progress}%，状态：${cfg.label}。\n${roleFlavor(agent, 'progress')}`;
  } else if (/问题|风险|卡点|issue/.test(t)) {
    text = agent.issues.length
      ? `当前问题清单（${agent.issues.length} 项）：\n${agent.issues.map((i,idx) => `${idx+1}. ${i}`).join('\n')}`
      : '当前无已知问题，执行平稳。';
  } else if (/暂停|停/.test(t)) {
    agent.status = 'paused';
    updateWorkerBadge(agent);
    text = `⏸ 已暂停执行，等待你的进一步确认。当前进度保留在 ${agent.progress}%，随时可恢复。`;
  } else if (/加快|加速|提速/.test(t)) {
    text = roleFlavor(agent, 'speed');
    if (agent.status === 'pending') text = '当前任务尚未启动（等待上游依赖），暂无法提速。建议先推进上游 Agent。';
  } else if (/结果|产出|完成|交付|验收/.test(t)) {
    text = `产出概要：${agent.acceptance}\n${agent.prNum ? `PR：${agent.prNum}（${agent.prTitle}）` : 'PR 尚未提交，任务进行中。'}`;
  } else if (/依赖|输入|上下文|context/.test(t)) {
    text = `所需上下文：\n${agent.contextNeeds.map(c => `• ${c}`).join('\n')}`;
  } else if (/claude|规范|边界/.test(t)) {
    text = `我的工作边界与规范见 Claude.md：仅负责 ${agent.role} 相关产物，不得越界修改其他模块目录。`;
  } else {
    text = `收到指令：「${input}」\n我将据此调整执行方向，稍后反馈进展。\n\n${roleFlavor(agent, 'default')}`;
  }
  return text;
}

function roleFlavor(agent, kind) {
  const map = {
    'dataset-builder': {
      progress: '已采样 2000 条，元数据完整率 99.6%，类型分布误差 0.3%。',
      speed: '评测集构造已完成，无需提速。如需扩展规模可追加采样。',
      default: '将核对商户分布并补全缺失元数据字段。',
    },
    'image-generator': {
      progress: '已生成 1880/2000，成功率 97.1%，平均 4.6s/张。',
      speed: '当前并发 10（API 限速 QPS=12）。可提到 12 但有 429 风险，建议优先调度剩余批次。',
      default: '将调整批次调度并记录 Prompt 版本。',
    },
    'quality-checker': {
      progress: '已质检 1900 张，badcase 率 11.2%，场景图文字截断最突出。',
      speed: '质检已进入收尾（95%），无需提速。剩余批次预计 38 分钟内完成。',
      default: '将汇总 badcase 并流式推送给 RCA Agent。',
    },
    'rca-analyst': {
      progress: '分析覆盖率 35%，已识别 4 类 P类问题，初步报告已推送。',
      speed: '当前实时接收质检流，已并行分析。可加深 P类样例归因深度。',
      default: '将深化 P类根因归因并更新优先级排序。',
    },
    'prompt-tuner': {
      progress: '尚未启动（等待 rca_report_v1.json），已读完 v3 模板库做准备。',
      speed: '依赖未就绪，暂无法启动。RCA 完成后预计 65 分钟产出 v4。',
      default: '将基于 RCA 结论定向修复 P类问题，输出 v4 模板与 A/B 方案。',
    },
  };
  return (map[agent.id] && map[agent.id][kind]) || '将按规范推进任务。';
}

function sendWorkerMsg() {
  const ta = document.getElementById('mock-chat-textarea');
  const text = ta.value.trim();
  if (!text || !currentAgentId) return;
  const a = AGENTS.find(x => x.id === currentAgentId);
  const now = timeNow();
  a.conversations.push({ role: 'user', text, time: now });
  ta.value = '';
  if (currentTab === 'convo') renderPanelTab('convo', a);

  // typing 指示
  showTyping(a);
  setTimeout(() => {
    const reply = mockReply(a, text);
    a.conversations.push({ role: 'agent', text: reply, time: timeNow() });
    if (currentTab === 'convo') renderPanelTab('convo', a);
  }, 700);
}

function showTyping(a) {
  if (currentTab !== 'convo') return;
  const convo = document.getElementById('panel-convo');
  if (!convo) return;
  const t = document.createElement('div');
  t.className = 'panel-msg agent';
  t.id = 'typing-indicator';
  t.innerHTML = `<div class="msg-role">🤖 ${a.name} Agent · 输入中</div><div class="msg-text"><span class="typing-dots"><span></span><span></span><span></span></span></div>`;
  convo.appendChild(t);
  convo.scrollTop = convo.scrollHeight;
  setTimeout(() => t.remove(), 700);
}

document.getElementById('mock-chat-send').addEventListener('click', sendWorkerMsg);
document.getElementById('mock-chat-textarea').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendWorkerMsg(); }
});

// ════════════════════════════════════════════════════
// 主 Agent 面板 (需求沟通)
// ════════════════════════════════════════════════════
let mainChatIdx = 0;

function openMainPanel() {
  closeWorkerPanel();
  document.getElementById('mock-main-panel').classList.add('open');
  // 首次打开播第一条
  if (mainChatIdx === 0) {
    setTimeout(() => advanceMainScript(), 300);
  }
}

function closeMainPanel() {
  document.getElementById('mock-main-panel').classList.remove('open');
}
document.getElementById('mph-main-close-btn').addEventListener('click', closeMainPanel);

function appendMainMsg(container, msg) {
  const div = document.createElement('div');
  div.className = `msg ${msg.role}`;
  const avatar = msg.role === 'user'
    ? `<div class="msg-avatar" style="background:var(--surface2);border:1px solid var(--border);color:var(--text2)">我</div>`
    : `<div class="msg-avatar" style="background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff">M</div>`;
  div.innerHTML = `${avatar}<div><div class="msg-bubble"><p>${esc(msg.text)}</p></div><div class="msg-time">${msg.time || ''}</div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function revealTasks(indices) {
  const list = document.getElementById('task-list');
  const empty = list.querySelector('[data-empty]');
  if (empty) list.innerHTML = '';
  indices.forEach(i => {
    const a = AGENTS[i];
    const card = document.createElement('div');
    card.className = 'task-card';
    card.innerHTML = `
      <div class="task-card-header">
        <div class="mac-avatar" style="background:${a.color}22;color:${a.color};width:24px;height:24px;font-size:12px">${a.avatar}</div>
        <span class="task-card-title">${esc(a.fullName)}</span>
      </div>
      <div class="task-card-desc">${esc(a.task.substring(0, 60))}…</div>
      <div class="task-card-meta">
        <span class="tag">${esc(a.model)}</span>
        <span class="tag">${esc(a.role)}</span>
      </div>`;
    list.appendChild(card);
    setTimeout(() => card.classList.add('visible'), 50);
  });
  document.getElementById('task-count').textContent = `${list.querySelectorAll('.task-card').length} 个 Agent`;
}

function advanceMainScript() {
  const container = document.getElementById('main-chat-messages');
  if (mainChatIdx >= MAIN_CHAT_SCRIPT.length) {
    document.getElementById('btn-generate-plan').classList.remove('hidden');
    document.getElementById('main-chat-hint').textContent = '需求已确认，可进入执行阶段';
    return;
  }
  const msg = MAIN_CHAT_SCRIPT[mainChatIdx++];
  // 只播 agent 的脚本消息（user 消息由用户发送触发）
  if (msg.role === 'agent') {
    appendMainMsg(container, msg);
    if (msg.taskReveal && msg.taskReveal.length) revealTasks(msg.taskReveal);
    if (mainChatIdx >= MAIN_CHAT_SCRIPT.length) {
      document.getElementById('btn-generate-plan').classList.remove('hidden');
      document.getElementById('main-chat-hint').textContent = '需求已确认，可进入执行阶段';
    }
  }
}

function sendMainMsg() {
  const input = document.getElementById('main-chat-input');
  const text = input.value.trim();
  const container = document.getElementById('main-chat-messages');
  if (text) {
    appendMainMsg(container, { role: 'user', text, time: timeNow() });
    input.value = '';
  }
  // 推进下一条 agent 脚本
  if (mainChatIdx < MAIN_CHAT_SCRIPT.length) {
    // 跳过中间的 user 脚本条目，找到下一条 agent
    setTimeout(() => {
      while (mainChatIdx < MAIN_CHAT_SCRIPT.length && MAIN_CHAT_SCRIPT[mainChatIdx].role !== 'agent') mainChatIdx++;
      advanceMainScript();
    }, 600);
  } else {
    // 脚本结束，自由输入 → canned 回复
    setTimeout(() => {
      appendMainMsg(container, {
        role: 'agent',
        text: `收到：「${text}」\n\n分工方案已确认，5 个 Agent 已就绪。如需调整可继续沟通，或点击「确认方案 → 进入执行」启动执行。`,
        time: timeNow(),
      });
    }, 600);
  }
}

document.getElementById('main-chat-send').addEventListener('click', sendMainMsg);
document.getElementById('main-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMainMsg(); }
});

document.getElementById('btn-generate-plan').addEventListener('click', () => {
  setPhase('exec');
  closeMainPanel();
});

// ════════════════════════════════════════════════════
// 阶段流转
// ════════════════════════════════════════════════════
function setPhase(p) {
  phase = p;
  const steps = document.querySelectorAll('.phase-step');
  const order = ['chat', 'exec', 'verify'];
  const idx = order.indexOf(p);
  steps.forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i < idx) s.classList.add('done');
    else if (i === idx) s.classList.add('active');
  });
  document.getElementById('btn-verify').disabled = !(p === 'exec' || p === 'verify');
  if (p === 'exec') {
    document.getElementById('btn-verify').textContent = '进入验收 →';
  }
}

document.getElementById('btn-verify').addEventListener('click', () => {
  setPhase('verify');
  closeWorkerPanel(); closeMainPanel();
  openVerify();
});

// ════════════════════════════════════════════════════
// 验收视图
// ════════════════════════════════════════════════════
let verifyIdx = 0;

function openVerify() {
  document.getElementById('mock-verify-overlay').classList.add('open');
  renderVerify();
  if (verifyIdx === 0) {
    setTimeout(() => advanceVerifyScript(), 400);
  }
}

document.getElementById('verify-close-btn').addEventListener('click', () => {
  document.getElementById('mock-verify-overlay').classList.remove('open');
  setPhase('exec');
});

function renderVerify() {
  // 产出卡
  document.getElementById('result-grid').innerHTML = AGENTS.map(a => {
    const cfg = statusConfig[a.status] || statusConfig.pending;
    return `
      <div class="result-card">
        <div class="rc-header">
          <div class="rc-avatar" style="background:${a.color}22;color:${a.color}">${a.avatar}</div>
          <span class="rc-title">${esc(a.name)}</span>
        </div>
        <div class="rc-status"><span class="status-badge ${cfg.badgeClass}">${cfg.label}</span></div>
        ${a.prNum ? `<div class="rc-pr">${esc(a.prNum)}: ${esc((a.prTitle||'').substring(0,28))}…</div>` : `<div class="rc-pr none">PR 未提交</div>`}
        <div class="rc-issues">${a.issues.length ? a.issues.map(i => `<div class="issue-item"><span>•</span>${esc(i)}</div>`).join('') : '<span style="color:var(--green);font-size:11.5px">✓ 无问题</span>'}</div>
      </div>`;
  }).join('');

  // PR 列表
  const prs = AGENTS.filter(a => a.prNum);
  document.getElementById('pr-list').innerHTML = prs.length ? prs.map(a => {
    const cfg = statusConfig[a.prStatus] || statusConfig[a.status];
    return `
      <div class="pr-item">
        <div class="pr-avatar" style="background:${a.color}22;color:${a.color}">${a.avatar}</div>
        <span class="pr-num">${esc(a.prNum)}</span>
        <span class="pr-title">${esc(a.prTitle)}</span>
        <span class="status-badge ${cfg.badgeClass}">${cfg.label}</span>
      </div>`;
  }).join('') : '<div style="color:var(--text3);font-size:13px">暂无 PR</div>';

  // 问题列表
  const allIssues = AGENTS.flatMap(a => a.issues.map(i => ({ agent: a.name, color: a.color, issue: i })));
  document.getElementById('issue-list').innerHTML = allIssues.length
    ? allIssues.map(i => `<div class="verify-issue-row"><span class="vir-agent" style="color:${i.color}">${esc(i.agent)}</span><span class="vir-text">⚠ ${esc(i.issue)}</span></div>`).join('')
    : '<div style="color:var(--green);font-size:13px">✓ 暂无问题</div>';
}

function advanceVerifyScript() {
  const container = document.getElementById('verify-chat-messages');
  if (verifyIdx >= VERIFY_CHAT_SCRIPT.length) return;
  const msg = VERIFY_CHAT_SCRIPT[verifyIdx++];
  if (msg.role === 'agent') appendVerifyMsg(msg);
}

function appendVerifyMsg(msg) {
  const container = document.getElementById('verify-chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${msg.role}`;
  const avatar = msg.role === 'user'
    ? `<div class="msg-avatar" style="background:var(--surface2);border:1px solid var(--border);color:var(--text2)">我</div>`
    : `<div class="msg-avatar" style="background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff">M</div>`;
  div.innerHTML = `${avatar}<div><div class="msg-bubble"><p>${esc(msg.text)}</p></div><div class="msg-time">${msg.time || ''}</div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendVerifyMsg() {
  const input = document.getElementById('verify-chat-input');
  const text = input.value.trim();
  if (!text) return;
  const container = document.getElementById('verify-chat-messages');
  appendVerifyMsg({ role: 'user', text, time: timeNow() });
  input.value = '';
  // 推进下一条 agent 脚本，否则 canned
  if (verifyIdx < VERIFY_CHAT_SCRIPT.length) {
    setTimeout(() => {
      while (verifyIdx < VERIFY_CHAT_SCRIPT.length && VERIFY_CHAT_SCRIPT[verifyIdx].role !== 'agent') verifyIdx++;
      advanceVerifyScript();
    }, 600);
  } else {
    setTimeout(() => {
      appendVerifyMsg({
        role: 'agent',
        text: `收到：「${text}」\n\n基于各 Agent 产出数据，最需关注的是图片生成 Agent（#2）的失败盲区与并发限速问题，以及质检 Agent（#3）发现的场景图文字截断系统性缺陷。建议在 RCA 全量完成后立即进入第二轮优化循环，优先由提示词调优 Agent（#5）输出 v4 模板。`,
        time: timeNow(),
      });
    }, 700);
  }
}

document.getElementById('verify-chat-send').addEventListener('click', sendVerifyMsg);
document.getElementById('verify-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendVerifyMsg(); }
});

// ════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function timeNow() {
  return new Date().toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' });
}

// ════════════════════════════════════════════════════
// 启动
// ════════════════════════════════════════════════════
renderCanvas();
applyTransform();
setPhase('chat');
