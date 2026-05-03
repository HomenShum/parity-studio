import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export const availableLocales = ['en', 'zh-CN'] as const;
export type Locale = (typeof availableLocales)[number];

type TranslationValue = string | TranslationTree;
type TranslationTree = { [key: string]: TranslationValue };
type Params = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'parity.studio.locale';

export const localeLabels: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
};

const en: TranslationTree = {
  app: {
    newDesignSession: 'New design session',
    defaultRunTitle: 'Reimagine recording demo into parity UI kit',
    workflow: {
      start: 'Start',
      create: 'Create',
      improve: 'Improve',
      verify: 'Verify',
      export: 'Export',
    },
    exportWarning:
      '{{passCount}}/{{totalChecks}} checks pass. Improve first for a safer handoff, or export anyway if you only need a draft.',
  },
  breadcrumb: {
    projects: 'Projects',
    star: 'Star this design',
    unstar: 'Unstar this design',
  },
  header: {
    commentOnPreview: 'Comment on preview',
    previewDevice: 'Preview device',
    zoomLevel: 'Zoom level',
    export: 'Export',
    exportDraft: 'Export draft',
    notReadyYet: 'Not ready yet.',
    language: 'Language',
    formats: {
      zip: {
        label: 'Canonical ZIP',
        sublabel: 'Full skill-pack - round-trips back into Parity Studio',
      },
      html: {
        label: 'Single HTML',
        sublabel: 'index.html with tokens inlined; drop into a CMS',
      },
      markdown: {
        label: 'Markdown',
        sublabel: 'Prose handoff for coding agents',
      },
    },
  },
  device: {
    desktop: 'Desktop',
    tablet: 'Tablet',
    phone: 'Phone',
  },
  history: {
    collapsedLabel: 'Project history collapsed',
    expandedLabel: 'Project and run history',
    expand: 'Expand history',
    collapse: 'Collapse history',
    workspace: 'Workspace',
    workspaceHint: 'projects + runs',
    newRun: 'New run',
    aiKey: 'AI key',
    keysAndByok: 'Keys and BYOK',
    recentRuns: 'Recent runs',
    startNewRun: 'Start new run',
    startNewRunEyebrow: 'prompt / image / ui_kit zip',
    projects: 'Projects',
    runStatus: 'Run status',
    viewAllRuns: 'View all runs',
    viewAllActivity: 'View all activity',
    loading: 'loading',
    loadingProjects: 'loading projects...',
    noProjects: 'no projects in this tab yet',
    loadingRuns: 'loading runs...',
    noRuns: 'no runs yet',
    noTelemetry: 'status telemetry appears here after a run starts',
    active: '{{count}} active',
    empty: 'empty',
    starred: 'starred',
    runCount: '{{count}} run{{plural}}',
    untitledRun: 'Untitled run',
    justNow: 'just now',
    minutesAgo: '{{count}}m ago',
    hoursAgo: '{{count}}h ago',
    daysAgo: '{{count}}d ago',
    status: {
      queued: 'queued',
      generating: 'generating',
      decomposing: 'decomposing',
      verifying: 'verifying',
      iterating: 'iterating',
      done: 'done',
      failed: 'failed',
    },
    statusSummary: {
      diagnosing: 'Diagnosing',
      generating: 'Generating',
      verifying: 'Verifying',
      complete: 'Complete',
    },
  },
  byok: {
    modalTitle: 'Use my own AI key',
    modalEyebrow: 'optional - this browser tab only',
    modalCopy:
      'Optional. Use this only if you want Parity Studio to work with your own AI provider account. Local MCP BYOK is the safest path today: provider keys stay on your machine and only generated artifacts are imported.',
    panelLabel: 'Session privacy and BYOK',
    panelTitle: 'Session privacy + BYOK',
    panelSubtitle: '{{count}} key{{plural}} in tab memory - session {{session}}',
    manage: 'manage',
    hide: 'hide',
    privacyCopy:
      'Hosted Parity Studio does not store provider keys. These fields use sessionStorage, which is scoped to this browser tab. For actual BYOK model calls, use the copied MCP env block locally; only generated artifacts and redacted source context are uploaded when import is enabled.',
    saveInTab: 'Save in tab',
    copyMcpEnv: 'Copy MCP env',
    clearKeys: 'Clear keys',
    newSession: 'New session',
    saved: 'Saved to this browser tab only.',
    cleared: 'Session keys cleared from this tab.',
    copied: 'Copied local MCP env block.',
    sessionCleared: 'Session and keys cleared from this tab.',
    notSet: 'not set',
    set: 'set',
  },
  agent: {
    collapsedLabel: 'Agent stream collapsed',
    expand: 'Expand agent stream',
    openChat: 'Open agent chat',
    label: 'Agent stream',
    subtitle: 'chat + tool calls for selected run',
    repo: 'View Parity Studio repository on GitHub',
    collapse: 'Collapse agent stream',
    launchSubtitle: 'Start, import, switch history, and chat in one place.',
    chatHistory: 'Chat history',
    startRunTitle: 'Start with an idea, image, or ui_kit.',
    startRunCopy:
      'Choose a model route, describe what you want, attach a source image, or import a canonical ui_kit ZIP. The agent stream will stay attached to the new run.',
    launchPrompt: 'Prompt',
    launchPromptBody: 'Describe a screen or product flow and let Parity create the first artifact.',
    launchImage: 'Image',
    launchImageBody:
      'Attach a source mockup or generate one from your prompt before decomposition.',
    launchZip: 'ui_kit ZIP',
    launchZipBody: 'Import an existing canonical kit and continue scoped editing immediately.',
  },
  chat: {
    startTitle: 'Start a run to chat.',
    startBody:
      'The agent edits any file in the canonical shape via tool calls. Start or import a source below.',
    loading: 'loading conversation...',
    sending: 'sending...',
    placeholder:
      "Tell the agent what to change... 'soften the radius on Card to 12px and update the preview' / 'rewrite assets/og-foo.svg with darker text'",
    aria: 'Chat with the parity-studio agent',
    helper: 'cmd/ctrl + enter to send - sparkle rewrites the draft before sending (~$0.002)',
    enhance: 'Rewrite draft before sending with the small model',
    enhanceTitle:
      'Rewrite your draft into a clearer, more specific prompt before sending. Uses the small model and costs about $0.002 per call.',
    send: 'Send to agent',
    emptyTitle: 'Tell the agent what to improve.',
    emptyBodyPrefix: 'Use plain language. Try:',
    emptyExample1: 'make the main button more obvious',
    emptyExample2: 'make this look closer to the source image',
    emptyExample3: 'fix the highest-impact issue from the coach.',
    askAgentToFix: 'Ask agent to fix: {{issue}}',
    askAgentDefault: 'Ask agent to fix the current issue.',
    toolComplete: 'complete',
    agentMadePlan: 'Agent made a plan.',
    agentPlan: 'Agent plan',
    tools: {
      list_files: 'Looking at files',
      read_file: 'Reading a file',
      read_design_system: 'Checking design rules',
      upsert_file: 'Updating the UI',
      set_todos: 'Planning fixes',
      done: 'Finished a step',
      iterate_now: 'Suggesting another pass',
      tool: 'tool',
    },
  },
  composer: {
    placeholder: "Describe a design... try 'Pitch deck for a fintech startup'",
    launchPlaceholder:
      "Describe the product surface, drop an image, or import a ui_kit ZIP... e.g. 'dashboard settings page with Stripe-like docs clarity'",
    describeDesign: 'Describe the design',
    attach: 'Attach an image or import a ui_kit zip',
    attachTitle: 'Attach image (png/jpeg/webp <= 2 MB) or import a canonical ui_kit zip (<= 30 MB)',
    zipTitle: 'zip drop on the paperclip imports a ui_kit',
    generateImage: 'Generate image with gpt-image-2',
    generateImageTitle: 'Generate a source image from the prompt',
    generate: 'Generate',
    startRun: 'Start run',
    startingRun: 'Starting run...',
    helper: 'cmd/ctrl + enter to run - ~$0.10-0.80 per pipeline',
    typePromptFirst: 'type a prompt first, then click sparkles to generate an image',
    addPromptOrImage: 'add a prompt or an image to generate',
    onlySupported: 'only png / jpeg / webp / zip supported',
    zipTooLarge: 'zip too large ({{size}} MB > 30 MB cap)',
    imageTooLarge: 'image too large ({{size}} MB > 2 MB cap)',
    noUiKitFolder:
      'no ui_kits/<slug>/ folder found in zip - expected canonical NodeBench skill-pack shape',
    importedWithOthers:
      'imported {{slug}} ({{count}} files) - {{otherCount}} other slug{{plural}} preserved upstream: {{others}}',
    imported: 'imported {{slug}} ({{count}} files)',
    routerSuffix: '{{tier}} router',
  },
  model: {
    aiChoice: 'AI choice',
    aiChoiceWithSelection: 'AI choice: {{selection}}',
    chooseAiModel: 'Choose AI model',
    copy: 'Pick how much quality/cost you want for this run. If you are unsure, leave this on Balanced AI.',
    advanced: 'Advanced: use your own model',
    advancedCopy:
      'Only change this if you know your provider and model id. Key values are never stored in the run.',
    active: 'Active',
    default: 'default',
    highestQuality: 'highest quality',
    freeRoute: '$0 LLM route',
    custom: 'custom',
    balanced: {
      label: 'Balanced AI',
      detail: 'Recommended quality and cost',
    },
    frontier: {
      label: 'Best quality AI',
      detail: 'Slower and more expensive',
    },
    free: {
      label: 'Free AI route',
      detail: 'Uses free-capable models when available',
    },
    customProvider: 'Custom model provider',
    customModelId: 'Custom model id',
    customModelPlaceholder: 'provider model id, e.g. moonshotai/kimi-k2.6',
    useCustomModel: 'Use custom model',
  },
  pipeline: {
    stages: {
      generate: {
        label: 'Creating page',
        description: 'Turns your prompt or image into a first screen.',
      },
      decompose: {
        label: 'Breaking into parts',
        description: 'Splits the screen into reusable pieces the agent can edit.',
      },
      verify: {
        label: 'Checking match',
        description: 'Checks whether the result matches the intended design.',
      },
      iterate: {
        label: 'Improving',
        description: 'Repairs visible gaps before export.',
      },
    },
    editCount: '{{count}} edit{{plural}}',
    sourceCount: '{{count}} src',
  },
  canvas: {
    label: 'Artifact canvas',
    tabMode: 'Canvas view mode',
    files: 'Files',
    preview: 'Preview',
    inspiration: 'Inspiration',
    tweaks: 'Tweaks',
    toggleTweaks: 'Toggle tweaks panel',
  },
  parity: {
    coach: 'Parity coach',
    collapsedLabel: 'Parity coach collapsed',
    expand: 'Expand Parity Coach',
    openChecks: 'Open parity checks',
    label: 'Parity coach and deterministic checks',
    collapse: 'Collapse Parity Coach',
    checksPassing: 'checks passing',
    parityScore: 'Parity score',
    statusPrefix: 'Status:',
    topRecommendations: 'Top recommendations',
    priorityHigh: 'High',
    priorityMedium: 'Medium',
    whyThisMatters: 'Why this matters:',
    evidenceTitle: 'Evidence:',
    evidenceUnavailable:
      'Needs stronger browser or screenshot evidence before we call this specific.',
    likelyFiles: 'Likely files:',
    recommendations: {
      listFirst: 'Adopt list-first layout',
      componentBoundary: 'Clarify component boundaries',
      hierarchy: 'Increase hierarchy contrast',
      colorUsage: 'Simplify color usage',
      spacing: 'Standardize spacing scale',
      accessibility: 'Verify accessibility basics',
      visibleMismatch: 'Repair visible mismatch',
    },
    recommendationRationales: {
      listFirst:
        'The page needs a clearer primary structure so first-time users know where to look, what changed, and which action matters most.',
      componentBoundary:
        'The generated UI is missing or flattening key structural pieces, so the result can feel like a static mockup instead of a working product surface.',
      hierarchy:
        'Weak type hierarchy makes important copy and actions harder to scan, which increases decision fatigue for non-technical users.',
      colorUsage:
        'Too many or mismatched colors make the UI feel inconsistent even when the broad layout looks close.',
      spacing:
        'Uneven spacing, radius, or elevation makes the surface feel less intentional and harder to trust.',
      accessibility:
        'Semantic and accessible affordances determine whether keyboard and screen-reader users can navigate the result.',
      visibleMismatch:
        'This is one of the clearest visible gaps between the target and generated UI, so fixing it should improve perceived quality quickly.',
    },
    verdict: {
      pass: 'Pass',
      warn: 'Warn',
      fail: 'Fail',
      unavailable: 'n/a',
    },
    donutLabel: 'Parity {{pass}} pass, {{warn}} warn, {{fail}} fail',
    checks: {
      structureParity: 'Structure parity',
      componentCount: 'Component count',
      layoutGrid: 'Layout grid',
      spacingSystem: 'Spacing system',
      typographyScale: 'Typography scale',
      fontFidelity: 'Font fidelity',
      colorTokens: 'Color tokens',
      colorDelta: 'Color delta',
      borderRadius: 'Border radius',
      shadowsElevation: 'Shadows & elevation',
      iconography: 'Iconography',
      responsiveBreakpoints: 'Responsive breakpoints',
      interactionStates: 'Interaction states',
      accessibility: 'Accessibility',
      semanticHtml: 'Semantic HTML',
      visualRegression: 'Visual regression',
    },
    status: {
      idle: 'Idle',
      queued: 'Queued',
      generating: 'Generating',
      decomposing: 'Decomposing & verifying',
      verifying: 'Verifying',
      iterating: 'Iterating',
      failed: 'Failed',
      verified: 'Verified',
      complete: 'Pipeline complete',
    },
    qualityVerified: 'Quality gate: verified',
    qualityRepairing: 'Quality gate: repairing {{attempts}}/{{cap}}',
    qualityRepairs: 'Quality gate: {{attempts}}/{{cap}} repairs, target {{target}}/{{total}}',
    qualityTitle: 'Background repair attempts used by the native quality gate',
    readoutTitle: 'End-user impact readout',
    refreshTitle: 'Ask the agent to reinterpret the latest parity report',
    reading: 'Reading',
    refresh: 'Refresh',
    askFixTitle: 'Send the highest-impact repair request to the agent',
    askFix: 'Ask agent to fix this',
    filesAgentMayEdit: 'Files the agent may edit',
    agentLoading: 'agent refining this with the latest run context...',
    agentError: 'agent summary unavailable; showing screen-aware local guidance',
    agentLocal: 'screen-aware local guidance until agent summary returns',
    fixStarting: 'Starting agent fix...',
    fixStarted: 'Agent fix started in the chat stream.',
  },
  cost: {
    telemetry: 'Cost telemetry',
    total: 'Total',
    generate: 'Generate',
    decompose: 'Decompose',
    verify: 'Verify',
    typical: 'Typical full pipeline: $0.10-$0.80; current run shown above',
  },
};

const zhCN: TranslationTree = {
  app: {
    newDesignSession: '新的设计会话',
    defaultRunTitle: '将录制演示重构为 Parity UI kit',
    workflow: {
      start: '开始',
      create: '生成',
      improve: '改进',
      verify: '验证',
      export: '导出',
    },
    exportWarning:
      '当前通过 {{passCount}}/{{totalChecks}} 项检查。建议先改进以获得更安全的交接；如果只需要草稿，也可以继续导出。',
  },
  breadcrumb: {
    projects: '项目',
    star: '收藏这个设计',
    unstar: '取消收藏这个设计',
  },
  header: {
    commentOnPreview: '在预览上评论',
    previewDevice: '预览设备',
    zoomLevel: '缩放比例',
    export: '导出',
    exportDraft: '导出草稿',
    notReadyYet: '尚未准备好。',
    language: '语言',
    formats: {
      zip: {
        label: '标准 ZIP',
        sublabel: '完整 skill-pack，可再次导入 Parity Studio',
      },
      html: {
        label: '单页 HTML',
        sublabel: '内联 tokens 的 index.html，可放入 CMS',
      },
      markdown: {
        label: 'Markdown',
        sublabel: '给编码代理使用的文字交接说明',
      },
    },
  },
  device: {
    desktop: '桌面',
    tablet: '平板',
    phone: '手机',
  },
  history: {
    collapsedLabel: '项目历史已折叠',
    expandedLabel: '项目和运行历史',
    expand: '展开历史',
    collapse: '折叠历史',
    workspace: '工作区',
    workspaceHint: '项目 + 运行',
    newRun: '新建运行',
    aiKey: 'AI 密钥',
    keysAndByok: '密钥和 BYOK',
    recentRuns: '最近运行',
    startNewRun: '开始新运行',
    startNewRunEyebrow: '提示词 / 图片 / ui_kit zip',
    projects: '项目',
    runStatus: '运行状态',
    viewAllRuns: '查看所有运行',
    viewAllActivity: '查看所有活动',
    loading: '加载中',
    loadingProjects: '正在加载项目...',
    noProjects: '此标签页还没有项目',
    loadingRuns: '正在加载运行...',
    noRuns: '还没有运行',
    noTelemetry: '运行开始后会在这里显示状态',
    active: '{{count}} 个进行中',
    empty: '空',
    starred: '已收藏',
    runCount: '{{count}} 次运行',
    untitledRun: '未命名运行',
    justNow: '刚刚',
    minutesAgo: '{{count}} 分钟前',
    hoursAgo: '{{count}} 小时前',
    daysAgo: '{{count}} 天前',
    status: {
      queued: '排队中',
      generating: '生成中',
      decomposing: '拆解中',
      verifying: '验证中',
      iterating: '迭代中',
      done: '完成',
      failed: '失败',
    },
    statusSummary: {
      diagnosing: '诊断中',
      generating: '生成中',
      verifying: '验证中',
      complete: '完成',
    },
  },
  byok: {
    modalTitle: '使用我自己的 AI 密钥',
    modalEyebrow: '可选 - 仅保存在当前浏览器标签页',
    modalCopy:
      '可选。只有当你想使用自己的 AI 服务账号时才需要填写。当前最安全的方式是本地 MCP BYOK：服务商密钥留在你的电脑上，只导入生成产物。',
    panelLabel: '会话隐私和 BYOK',
    panelTitle: '会话隐私 + BYOK',
    panelSubtitle: '标签页内存中有 {{count}} 个密钥 - 会话 {{session}}',
    manage: '管理',
    hide: '隐藏',
    privacyCopy:
      '托管版 Parity Studio 不保存服务商密钥。这些字段使用 sessionStorage，只作用于当前浏览器标签页。真正的 BYOK 模型调用请使用复制出的本地 MCP 环境变量；启用导入时，只上传生成产物和脱敏后的来源上下文。',
    saveInTab: '保存在标签页',
    copyMcpEnv: '复制 MCP env',
    clearKeys: '清除密钥',
    newSession: '新会话',
    saved: '已保存到当前浏览器标签页。',
    cleared: '已从此标签页清除会话密钥。',
    copied: '已复制本地 MCP env 配置。',
    sessionCleared: '已从此标签页清除会话和密钥。',
    notSet: '未设置',
    set: '已设置',
  },
  agent: {
    collapsedLabel: 'Agent 流已折叠',
    expand: '展开 Agent 流',
    openChat: '打开 Agent 聊天',
    label: 'Agent 流',
    subtitle: '当前运行的聊天和工具调用',
    repo: '在 GitHub 查看 Parity Studio 仓库',
    collapse: '折叠 Agent 流',
    launchSubtitle: '在同一处开始、导入、切换历史并继续聊天。',
    chatHistory: '聊天历史',
    startRunTitle: '从想法、图片或 ui_kit 开始。',
    startRunCopy:
      '选择模型路由，描述你想要的界面，附加来源图片，或导入标准 ui_kit ZIP。Agent 流会自动绑定到新运行。',
    launchPrompt: '提示词',
    launchPromptBody: '描述一个页面或产品流程，让 Parity 生成第一版产物。',
    launchImage: '图片',
    launchImageBody: '附加来源 mockup，或先用提示词生成图片再拆解。',
    launchZip: 'ui_kit ZIP',
    launchZipBody: '导入已有标准 kit，并立即继续范围化编辑。',
  },
  chat: {
    startTitle: '开始一次运行后即可聊天。',
    startBody: 'Agent 会通过工具调用编辑标准结构中的任何文件。请先从下方开始或导入来源。',
    loading: '正在加载对话...',
    sending: '发送中...',
    placeholder:
      '告诉 agent 要改什么... 例如“把 Card 圆角调到 12px 并更新预览” / “把 assets/og-foo.svg 的文字调深一些”',
    aria: '和 parity-studio agent 聊天',
    helper: 'cmd/ctrl + enter 发送 - sparkles 会先改写草稿（约 $0.002）',
    enhance: '用小模型在发送前改写草稿',
    enhanceTitle: '把你的草稿改写得更清晰、更具体。使用小模型，每次大约 $0.002。',
    send: '发送给 agent',
    emptyTitle: '告诉 agent 要改进什么。',
    emptyBodyPrefix: '直接用自然语言即可。可以试试：',
    emptyExample1: '让主按钮更明显',
    emptyExample2: '让它更接近来源图片',
    emptyExample3: '修复 coach 提到的最高影响问题。',
    askAgentToFix: '让 agent 修复：{{issue}}',
    askAgentDefault: '让 agent 修复当前问题。',
    toolComplete: '完成',
    agentMadePlan: 'Agent 已制定计划。',
    agentPlan: 'Agent 计划',
    tools: {
      list_files: '查看文件',
      read_file: '读取文件',
      read_design_system: '检查设计规则',
      upsert_file: '更新 UI',
      set_todos: '规划修复',
      done: '完成一步',
      iterate_now: '建议再迭代一次',
      tool: '工具',
    },
  },
  composer: {
    placeholder: '描述一个设计... 例如“金融科技初创公司的 pitch deck”',
    launchPlaceholder:
      '描述产品界面、拖入图片，或导入 ui_kit ZIP... 例如“像 Stripe 文档一样清晰的 dashboard settings 页面”',
    describeDesign: '描述这个设计',
    attach: '附加图片或导入 ui_kit zip',
    attachTitle: '附加图片（png/jpeg/webp <= 2 MB）或导入标准 ui_kit zip（<= 30 MB）',
    zipTitle: '把 zip 放到回形针入口会导入 ui_kit',
    generateImage: '用 gpt-image-2 生成图片',
    generateImageTitle: '根据提示词生成来源图片',
    generate: '生成',
    startRun: '开始运行',
    startingRun: '正在开始运行...',
    helper: 'cmd/ctrl + enter 运行 - 每次完整流水线约 $0.10-0.80',
    typePromptFirst: '请先输入提示词，再点击 sparkles 生成图片',
    addPromptOrImage: '请添加提示词或图片再生成',
    onlySupported: '只支持 png / jpeg / webp / zip',
    zipTooLarge: 'zip 太大（{{size}} MB > 30 MB 上限）',
    imageTooLarge: '图片太大（{{size}} MB > 2 MB 上限）',
    noUiKitFolder: 'zip 中没有 ui_kits/<slug>/ 文件夹 - 需要标准 NodeBench skill-pack 结构',
    importedWithOthers:
      '已导入 {{slug}}（{{count}} 个文件）- 另有 {{otherCount}} 个 slug 已保留在上游：{{others}}',
    imported: '已导入 {{slug}}（{{count}} 个文件）',
    routerSuffix: '{{tier}} 路由',
  },
  model: {
    aiChoice: 'AI 选择',
    aiChoiceWithSelection: 'AI 选择：{{selection}}',
    chooseAiModel: '选择 AI 模型',
    copy: '选择本次运行的质量/成本策略。如果不确定，保持 Balanced AI 即可。',
    advanced: '高级：使用自己的模型',
    advancedCopy: '只有在你知道服务商和模型 ID 时才需要修改。密钥不会保存在运行记录里。',
    active: '当前',
    default: '默认',
    highestQuality: '最高质量',
    freeRoute: '$0 LLM 路由',
    custom: '自定义',
    balanced: {
      label: '均衡 AI',
      detail: '推荐的质量和成本',
    },
    frontier: {
      label: '最高质量 AI',
      detail: '更慢且成本更高',
    },
    free: {
      label: '免费 AI 路由',
      detail: '优先使用可用的免费模型',
    },
    customProvider: '自定义模型服务商',
    customModelId: '自定义模型 ID',
    customModelPlaceholder: '服务商模型 ID，例如 moonshotai/kimi-k2.6',
    useCustomModel: '使用自定义模型',
  },
  pipeline: {
    stages: {
      generate: {
        label: '生成页面',
        description: '把提示词或图片变成第一版界面。',
      },
      decompose: {
        label: '拆成组件',
        description: '把界面拆成 agent 可以编辑的复用部件。',
      },
      verify: {
        label: '检查匹配度',
        description: '检查结果是否符合目标设计。',
      },
      iterate: {
        label: '改进中',
        description: '在导出前修复可见差距。',
      },
    },
    editCount: '{{count}} 次编辑',
    sourceCount: '{{count}} 来源',
  },
  canvas: {
    label: '产物画布',
    tabMode: '画布视图模式',
    files: '文件',
    preview: '预览',
    inspiration: '灵感',
    tweaks: '微调',
    toggleTweaks: '切换微调面板',
  },
  parity: {
    coach: 'Parity Coach',
    collapsedLabel: 'Parity Coach 已折叠',
    expand: '展开 Parity Coach',
    openChecks: '打开匹配检查',
    label: 'Parity Coach 和确定性检查',
    collapse: '折叠 Parity Coach',
    checksPassing: '项检查通过',
    parityScore: '匹配分数',
    statusPrefix: '状态：',
    topRecommendations: '优先建议',
    priorityHigh: '高',
    priorityMedium: '中',
    whyThisMatters: '为什么重要：',
    evidenceTitle: '证据：',
    evidenceUnavailable: '还需要更强的浏览器或截图证据，才能给出更具体的判断。',
    likelyFiles: '可能相关文件：',
    recommendations: {
      listFirst: '采用列表优先布局',
      componentBoundary: '理清组件边界',
      hierarchy: '增强层级对比',
      colorUsage: '简化颜色使用',
      spacing: '统一间距尺度',
      accessibility: '验证无障碍基础',
      visibleMismatch: '修复可见差异',
    },
    recommendationRationales: {
      listFirst:
        '页面需要更清晰的主结构，让第一次使用的人知道先看哪里、发生了什么变化、哪个操作最重要。',
      componentBoundary:
        '生成结果缺少或压平了关键结构部件，所以界面会像静态模型，不像真正的产品页面。',
      hierarchy: '字体层级不足会让重要文案和操作更难快速扫读，增加非技术用户的决策负担。',
      colorUsage: '颜色过多或不匹配会让界面显得不一致，即使整体布局看起来接近。',
      spacing: '间距、圆角或阴影不统一会降低界面的精致度和可信度。',
      accessibility: '语义和无障碍能力决定键盘和读屏用户能否顺利使用结果。',
      visibleMismatch: '这是目标与生成界面之间最明显的可见差异之一，优先修复可以快速提升体感质量。',
    },
    verdict: {
      pass: '通过',
      warn: '警告',
      fail: '失败',
      unavailable: '暂无',
    },
    donutLabel: 'Parity：{{pass}} 项通过，{{warn}} 项警告，{{fail}} 项失败',
    checks: {
      structureParity: '结构匹配',
      componentCount: '组件数量',
      layoutGrid: '布局网格',
      spacingSystem: '间距系统',
      typographyScale: '字号层级',
      fontFidelity: '字体还原',
      colorTokens: '颜色令牌',
      colorDelta: '颜色差异',
      borderRadius: '圆角',
      shadowsElevation: '阴影与层级',
      iconography: '图标系统',
      responsiveBreakpoints: '响应式断点',
      interactionStates: '交互状态',
      accessibility: '无障碍',
      semanticHtml: '语义 HTML',
      visualRegression: '视觉回归',
    },
    status: {
      idle: '空闲',
      queued: '排队中',
      generating: '生成中',
      decomposing: '拆解并验证中',
      verifying: '验证中',
      iterating: '迭代中',
      failed: '失败',
      verified: '已验证',
      complete: '流水线完成',
    },
    qualityVerified: '质量门：已验证',
    qualityRepairing: '质量门：正在修复 {{attempts}}/{{cap}}',
    qualityRepairs: '质量门：{{attempts}}/{{cap}} 次修复，目标 {{target}}/{{total}}',
    qualityTitle: '原生质量门的后台修复次数',
    readoutTitle: '终端用户影响解读',
    refreshTitle: '让 agent 重新解读最新匹配报告',
    reading: '读取中',
    refresh: '刷新',
    askFixTitle: '把最高影响修复请求发送给 agent',
    askFix: '让 agent 修复',
    filesAgentMayEdit: 'Agent 可能编辑的文件',
    agentLoading: 'agent 正在结合最新运行上下文重新解读...',
    agentError: 'agent 摘要不可用；显示本地屏幕感知指导',
    agentLocal: '在 agent 摘要返回前显示本地屏幕感知指导',
    fixStarting: '正在启动 agent 修复...',
    fixStarted: 'Agent 修复已在聊天流中启动。',
  },
  cost: {
    telemetry: '成本遥测',
    total: '总计',
    generate: '生成',
    decompose: '拆解',
    verify: '验证',
    typical: '典型完整流水线：$0.10-$0.80；上方显示当前运行',
  },
};

const resources: Record<Locale, TranslationTree> = {
  en,
  'zh-CN': zhCN,
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: string) => void;
  t: (key: string, params?: Params) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (availableLocales as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  if (isSupportedLocale(value)) return value;
  const lower = value.toLowerCase();
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh_cn' || lower.startsWith('zh-hans')) {
    return 'zh-CN';
  }
  if (lower.startsWith('en')) return 'en';
  console.warn(
    `[i18n] unsupported locale "${value}", falling back to "${DEFAULT_LOCALE}". Supported: ${availableLocales.join(', ')}`,
  );
  return DEFAULT_LOCALE;
}

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) return normalizeLocale(stored);
  return normalizeLocale(window.navigator.languages[0] ?? window.navigator.language);
}

function isDev(): boolean {
  const meta = import.meta as unknown as { env?: { DEV?: boolean } };
  return meta.env?.DEV ?? false;
}

function lookup(tree: TranslationTree, key: string): string | undefined {
  let cursor: TranslationValue | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = cursor[part];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function interpolate(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = params[key];
    return value === null || value === undefined ? match : String(value);
  });
}

export function translate(locale: Locale, key: string, params?: Params): string {
  const template = lookup(resources[locale], key) ?? lookup(resources[DEFAULT_LOCALE], key);
  if (template === undefined) {
    console.warn(`[i18n] missing translation key "${key}" for locale "${locale}"`);
    return isDev() ? `⟦${key}⟧` : key;
  }
  return interpolate(template, params);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());

  const setLocale = useCallback((next: string) => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
  }, [locale]);

  const t = useCallback((key: string, params?: Params) => translate(locale, key, params), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function useT(): (key: string, params?: Params) => string {
  return useI18n().t;
}
