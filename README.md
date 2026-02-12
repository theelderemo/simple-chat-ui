# Local AI Workbench

Simple local chat UI + Deno API server for multiple providers:

- AWS Bedrock
- OpenAI
- Azure OpenAI
- Google Gemini  

---

![screenshot](<Screenshot 2026-02-12 at 10-43-54 Bedrock Local Workbench.png>)

![screenshot2](<Screenshot 2026-02-12 at 10-44-56 Bedrock Local Workbench.png>)

![screenshot3](<Screenshot 2026-02-12 at 10-45-09 Bedrock Local Workbench.png>)

## Prerequisites

- [Deno](https://deno.com/) installed
- API credentials for any provider you want to use

## Install Deno (Linux/macOS)

```bash
curl -fsSL https://deno.land/install.sh | sh
source ~/.bashrc
```

## Environment Variables (Required for providers you use)

Create `.env` in the project root (copy the example.env):

```dotenv
AWS_BEARER_TOKEN_BEDROCK
AWS_DEFAULT_REGION=
OPENAI_API_KEY=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
GEMINI_API_KEY=
```

All tokens and API keys must be stored in `.env` and loaded by the server.

## Run

From the project root:

```bash
deno run --env-file=.env --allow-net --allow-read --allow-env server.ts
```

Then open:

- http://localhost:8000

## UI Configuration

Use the left Settings sidebar to:

- Switch memory mode (`One-shot` vs `Persistent`)
- Manage multiple conversations (new, switch, delete)
- In **Models** tab: configure backend/provider model setup (provider sections, model names/IDs, optional ARN/deployment, Bedrock advanced options) and run provider **Test** checks
- In **General** tab: pick a configured model and adjust frequently changed generation controls in a toggle card (`temperature`, `top_p`, `top_k`, `max_tokens`)
- Backend/provider secrets remain in `.env`

All settings and chats are stored locally in your browser.

