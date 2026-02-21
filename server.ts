import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type Provider = 'bedrock' | 'openai' | 'azure-openai' | 'gemini';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ModelConfig = {
  id: string;
  name?: string;
  provider: Provider;
  inferenceProfileArn?: string;
  azureDeployment?: string;
  bedrockMaxTokens?: number;
  bedrockStopSequences?: string[];
  bedrockThinkingType?: string;
  bedrockOutputEffort?: string;
  bedrockLatency?: string;
};

const normalizeMessages = (messages: unknown): ChatMessage[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((msg) => msg && typeof msg === 'object')
    .map((msg) => {
      const role: ChatMessage['role'] = (msg as { role?: string }).role === 'assistant' ? 'assistant' : 'user';
      const content = String((msg as { content?: string }).content ?? '');
      return { role, content };
    })
    .filter((msg) => msg.content.trim().length > 0);
};

const toOpenAIMessage = (msg: ChatMessage) => ({ role: msg.role, content: msg.content });

async function callBedrock(args: {
  messages: ChatMessage[];
  system: string;
  model: ModelConfig;
  temperature: number;
  maxTokens?: number;
  thinkingType?: string;
  outputEffort?: string;
}) {
  const bearerToken = Deno.env.get('AWS_BEARER_TOKEN_BEDROCK');
  const region = Deno.env.get('AWS_DEFAULT_REGION') || 'us-east-1';

  if (!bearerToken) {
    throw new Error('Missing Bedrock bearer token. Set AWS_BEARER_TOKEN_BEDROCK in .env.');
  }

  const modelId = args.model.inferenceProfileArn || args.model.id;
  const apiUrl = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

  const runtimeMaxTokens = Number.isFinite(Number(args.maxTokens))
    ? Math.min(64000, Math.max(1, Number(args.maxTokens)))
    : undefined;

  const modelMaxTokens = runtimeMaxTokens ?? (Number.isFinite(Number(args.model.bedrockMaxTokens))
    ? Math.min(64000, Math.max(1, Number(args.model.bedrockMaxTokens)))
    : 4096);

  const stopSequences = Array.isArray(args.model.bedrockStopSequences)
    ? args.model.bedrockStopSequences.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const additionalModelRequestFields = {
    ...((args.thinkingType || args.model.bedrockThinkingType)
      ? { thinking: { type: args.thinkingType || args.model.bedrockThinkingType } }
      : {}),
    ...((args.outputEffort || args.model.bedrockOutputEffort)
      ? { output_config: { effort: args.outputEffort || args.model.bedrockOutputEffort } }
      : {}),
  };

  const performanceConfig = args.model.bedrockLatency
    ? { latency: args.model.bedrockLatency }
    : undefined;

  const payload = {
    messages: args.messages.map((msg) => ({
      role: msg.role,
      content: [{ text: msg.content }]
    })),
    inferenceConfig: {
      temperature: args.temperature,
      maxTokens: modelMaxTokens,
      stopSequences,
    },
    system: args.system ? [{ text: args.system }] : undefined,
    additionalModelRequestFields: Object.keys(additionalModelRequestFields).length > 0 ? additionalModelRequestFields : undefined,
    performanceConfig,
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Bedrock API error ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  const textBlock = (data.output?.message?.content as any[])?.find((b: any) => b.text !== undefined);
return textBlock?.text || '';
}

async function callOpenAI(args: {
  messages: ChatMessage[];
  system: string;
  model: ModelConfig;
  temperature: number;
  topP?: number;
  maxTokens?: number;
}) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const baseUrl = (Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('Missing OpenAI API key. Set OPENAI_API_KEY in .env.');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: args.model.id,
      messages: [
        ...(args.system ? [{ role: 'system', content: args.system }] : []),
        ...args.messages.map(toOpenAIMessage),
      ],
      temperature: args.temperature,
      top_p: Number.isFinite(Number(args.topP)) ? Number(args.topP) : undefined,
      max_tokens: Number.isFinite(Number(args.maxTokens)) ? Number(args.maxTokens) : undefined,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  return data.choices?.[0]?.message?.content || '';
}

async function callAzureOpenAI(args: {
  messages: ChatMessage[];
  system: string;
  model: ModelConfig;
  temperature: number;
  topP?: number;
  maxTokens?: number;
}) {
  const apiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
  const endpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
  const apiVersion = Deno.env.get('AZURE_OPENAI_API_VERSION') || '2024-10-21';
  const deployment = args.model.azureDeployment || args.model.id;

  if (!apiKey || !endpoint) {
    throw new Error('Missing Azure OpenAI config. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT in .env.');
  }

  const normalizedEndpoint = endpoint.replace(/\/$/, '');
  const url = `${normalizedEndpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      messages: [
        ...(args.system ? [{ role: 'system', content: args.system }] : []),
        ...args.messages.map(toOpenAIMessage),
      ],
      temperature: args.temperature,
      top_p: Number.isFinite(Number(args.topP)) ? Number(args.topP) : undefined,
      max_tokens: Number.isFinite(Number(args.maxTokens)) ? Number(args.maxTokens) : undefined,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Azure OpenAI API error ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(args: {
  messages: ChatMessage[];
  system: string;
  model: ModelConfig;
  temperature: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
}) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const baseUrl = (Deno.env.get('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('Missing Gemini API key. Set GEMINI_API_KEY in .env.');
  }

  const url = `${baseUrl}/models/${encodeURIComponent(args.model.id)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const conversationText = args.messages
    .map((msg) => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}`)
    .join('\n\n');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: args.system
        ? {
            parts: [{ text: args.system }],
          }
        : undefined,
      contents: [
        {
          role: 'user',
          parts: [{ text: conversationText }],
        },
      ],
      generationConfig: {
        temperature: args.temperature,
        topP: Number.isFinite(Number(args.topP)) ? Number(args.topP) : undefined,
        topK: Number.isFinite(Number(args.topK)) ? Number(args.topK) : undefined,
        maxOutputTokens: Number.isFinite(Number(args.maxTokens)) ? Number(args.maxTokens) : undefined,
      },
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callProvider(args: {
  provider: Provider;
  messages: ChatMessage[];
  system: string;
  model: ModelConfig;
  temperature: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  thinkingType?: string;
  outputEffort?: string;
}) {
  switch (args.provider) {
    case 'bedrock':
      return callBedrock(args);
    case 'openai':
      return callOpenAI(args);
    case 'azure-openai':
      return callAzureOpenAI(args);
    case 'gemini':
      return callGemini(args);
    default:
      throw new Error(`Unsupported provider: ${args.provider}`);
  }
}

async function serveStatic(req: Request): Promise<Response> {
    try {
        const html = await Deno.readTextFile("./index.html");
        return new Response(html, {
            headers: { "content-type": "text/html" },
            status: 200,
        });
    } catch (e) {
        return new Response("index.html not found. Ensure it is in the same directory.", { status: 404 });
    }
}

console.log("Starting Local AI Server on http://localhost:8000");

serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return serveStatic(req);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (url.pathname === '/api/test-provider' && req.method === 'POST') {
      try {
        const body = await req.json();
        const provider = String(body.provider || '') as Provider;
        const modelFromBody = body.selectedModel as ModelConfig | undefined;

        if (!provider || !['bedrock', 'openai', 'azure-openai', 'gemini'].includes(provider)) {
          throw new Error('Invalid provider for connection test.');
        }

        if (!modelFromBody?.id) {
          throw new Error('A model is required to test provider connection.');
        }

        const model: ModelConfig = {
          ...modelFromBody,
          provider,
        };

        const probeText = await callProvider({
          provider,
          model,
          system: 'Return only OK',
          messages: [{ role: 'user', content: 'Health check. Reply OK.' }],
          temperature: 0,
        });

        return new Response(
          JSON.stringify({
            ok: true,
            provider,
            model: model.id,
            responsePreview: String(probeText || '').slice(0, 120),
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
          }
        );
      }
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
      try {
        const body = await req.json();
        const messages = normalizeMessages(body.messages);
        const system = String(body.system ?? '');
        const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7;
        const topP = Number.isFinite(Number(body.top_p)) ? Number(body.top_p) : undefined;
        const topK = Number.isFinite(Number(body.top_k)) ? Number(body.top_k) : undefined;
        const maxTokens = Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : undefined;
        const thinkingType = body.thinking_type ? String(body.thinking_type) : undefined;
        const outputEffort = body.output_effort ? String(body.output_effort) : undefined;

        const modelFromBody = body.selectedModel as ModelConfig | undefined;
        const model: ModelConfig = modelFromBody && modelFromBody.id && modelFromBody.provider
          ? modelFromBody
          : {
              id: String(body.model || 'amazon.nova-micro-v1:0'),
              provider: 'bedrock',
            };

        if (messages.length === 0) {
          throw new Error('messages must contain at least one user/assistant message.');
        }

        const messageContent = await callProvider({
          provider: model.provider,
          messages,
          system,
          model,
          temperature,
          topP,
          topK,
          maxTokens,
          thinkingType,
          outputEffort,
        });
        
        return new Response(
          JSON.stringify({
            role: 'assistant',
            content: messageContent
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          }
        );
      } catch (error) {
        console.error('Edge function error:', error);
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
          }
        );
      }
  }

  return new Response("Not Found", { status: 404 });
});