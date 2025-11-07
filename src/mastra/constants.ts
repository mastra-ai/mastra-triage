export const categories = [
  {
    name: 'Storage & Databases',
    squad: 'trio-tnt',
    keywords: ['Storage', 'Databases', 'Vector Databases', 'Database', 'Vector DB', 'Persistence'],
    assignWhen: 'Issue mentions storage, databases, or data persistence',
  },
  {
    name: 'Runtime Context',
    squad: 'trio-wp',
    keywords: ['Runtime Context', 'Context', 'Runtime'],
    assignWhen: 'Issue mentions runtime context or execution context',
  },
  {
    name: 'Mastra Server',
    squad: 'trio-wp',
    keywords: ['Hono', 'Mastra Server', 'API Server'],
    assignWhen: 'Issue mentions server functionality or API endpoints',
  },
  {
    name: 'Telemetry & Logging',
    squad: 'trio-tracery',
    keywords: ['Telemetry', 'Logging', 'Logs', 'Metrics', 'Monitoring'],
    assignWhen: 'Issue mentions telemetry, logging, or monitoring',
  },
  {
    name: 'Cloudflare & Deployment',
    squad: 'trio-wp',
    keywords: ['Cloudflare', 'Cloudflare Workers', 'Deployment', 'Deploy'],
    assignWhen: 'Issue mentions Cloudflare or deployment processes',
  },
  {
    name: 'AGUI / CopilotKit',
    squad: 'trio-wp',
    keywords: ['AGUI', 'CopilotKit'],
    assignWhen: 'Issue mentions AGUI or CopilotKit integration',
  },
  {
    name: 'Client SDK - js',
    squad: 'trio-wp',
    keywords: ['UI Components', 'React Components', 'ai-sdk', 'assistant-ui'],
    assignWhen: 'Issue mentions Frontend related implementation using AI-sdk, assistant-ui or any other tool.',
  },
  {
    name: 'Agents',
    squad: 'trio-wp',
    keywords: ['Agents', 'Agent', 'AI Agent'],
    assignWhen:
      'Issue mentions agent functionality (but not Agent Network) or anything related AI Models (OpenRouter, OpenAI, Claude, Anthropic, Gemini, Bedrock, ...)',
  },
  {
    name: 'Agent Network',
    squad: 'trio-tnt',
    keywords: ['Agent Network', 'Network', 'Multi-agent', 'Agent Communication'],
    assignWhen: 'Issue mentions agent networking or multi-agent systems',
  },
  {
    name: 'Guardrails & I/O Processing',
    squad: 'trio-wp',
    keywords: ['Guardrails', 'Input Output', 'I/O', 'Processing', 'Validation'],
    assignWhen: 'Issue mentions input/output processing or guardrails',
  },
  {
    name: 'A2A Protocol',
    squad: 'trio-wp',
    keywords: ['A2A', 'Agent to Agent', 'Protocol'],
    assignWhen: 'Issue mentions A2A protocol specifically',
  },
  {
    name: 'Tools & MCP',
    squad: 'trio-tb',
    keywords: ['Tools', 'MCP', 'Model Context Protocol', 'Tool Integration'],
    assignWhen: 'Issue mentions tools or MCP functionality',
  },
  {
    name: 'Workflows',
    squad: 'trio-tnt',
    keywords: ['Workflows', 'Steps', 'Suspend', 'Resume', 'Workflow Streaming'],
    assignWhen: 'Issue mentions workflow functionality, steps, or workflow management',
  },
  {
    name: 'UI / Dev Playground',
    squad: 'trio-tb',
    keywords: ['UI', 'Dev Playground', 'Playground', 'User Interface', 'Frontend'],
    assignWhen: 'Issue mentions UI components or development playground',
  },
  {
    name: 'Local Development',
    squad: 'trio-wp',
    keywords: ['Local Dev', 'Local Development', 'Development Environment', 'Dev Setup'],
    assignWhen: 'Issue mentions local development setup or environment',
  },
  {
    name: 'Memory',
    squad: 'trio-tb',
    keywords: ['Memory', 'Memory Management', 'Conversation Memory'],
    assignWhen: 'Issue mentions memory functionality or conversation history',
  },
  {
    name: 'RAG (Retrieval Augmented Generation)',
    squad: 'trio-tnt',
    keywords: ['RAG', 'Retrieval', 'Augmented Generation', 'Vector Search'],
    assignWhen: 'Issue mentions RAG or retrieval-based functionality',
  },
  {
    name: 'Voice & Speech',
    squad: 'trio-tron',
    keywords: ['Voice', 'Speech to Speech', 'Speech to Text', 'Text to Speech', 'Audio'],
    assignWhen: 'Issue mentions voice or speech functionality',
  },
  {
    name: 'Documentation',
    squad: 'trio-tracery',
    keywords: ['Documentation', 'Docs', 'README', 'API Docs'],
    assignWhen: 'Issue mentions general documentation (not chatbot or website)',
  },
  {
    name: 'Documentation Chatbot',
    squad: 'trio-tracery',
    keywords: ['Documentation Chatbot', 'Doc Bot', 'Chatbot'],
    assignWhen: 'Issue mentions documentation chatbot specifically',
  },
  {
    name: 'Documentation Website & Website',
    squad: 'trio-tracery',
    keywords: ['Documentation Website', 'Website', 'Site', 'Web'],
    assignWhen: 'Issue mentions website or documentation site',
  },
  {
    name: 'Mastra Cloud',
    squad: 'trio-tracery',
    keywords: ['Mastra Cloud', 'Cloud', 'Cloud Platform'],
    assignWhen: 'Issue mentions Mastra Cloud platform',
  },
  {
    name: 'Authentication',
    squad: 'trio-tron',
    keywords: ['Authentication', 'Auth', 'Authorization', 'Login', 'Logout'],
    assignWhen: 'Issue mentions authentication or authorization',
  },
];

// Login to Discord with your bot token
export const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
