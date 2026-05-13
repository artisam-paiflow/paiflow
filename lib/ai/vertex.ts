import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AiAdapter, AiMessage } from "./types";
import { AiError } from "./types";

const execAsync = promisify(exec);

export interface VertexAiConfig {
  projectId: string;
  region: string;
  model: string;
  /** Optional explicit token. If omitted, tries `gcloud auth print-access-token`. */
  accessToken?: string;
}

interface VertexContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface VertexCandidate {
  content?: VertexContent;
  finishReason?: string;
}

interface VertexResponse {
  candidates?: VertexCandidate[];
  error?: {
    message: string;
    code: number;
  };
}

/** Cached token to avoid blocking the event loop with execSync on every request. */
let cachedToken: { value: string; expiresAt: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes (tokens usually last 1 hour)

async function getAccessToken(config: VertexAiConfig): Promise<string> {
  if (config.accessToken) return config.accessToken;

  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  try {
    const { stdout } = await execAsync("gcloud auth print-access-token", {
      timeout: 10_000,
    });
    const token = stdout.trim();
    if (!token) throw new Error("gcloud returned empty token");

    cachedToken = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return token;
  } catch (err) {
    throw new AiError("Vertex AI requires authentication. Run: gcloud auth login", err);
  }
}

export class VertexAiAdapter implements AiAdapter {
  constructor(private readonly config: VertexAiConfig) {}

  async chat(messages: AiMessage[]): Promise<string> {
    const token = await getAccessToken(this.config);
    const url =
      `https://${this.config.region}-aiplatform.googleapis.com/v1/` +
      `projects/${this.config.projectId}/locations/${this.config.region}/` +
      `publishers/google/models/${this.config.model}:generateContent`;

    // Vertex AI only supports "user" and "model" roles
    const contents: VertexContent[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
      });
    } catch (err) {
      throw new AiError("Vertex AI is unreachable. Check your network.", err);
    }

    let data: VertexResponse;
    try {
      data = (await res.json()) as VertexResponse;
    } catch (err) {
      throw new AiError("Vertex AI returned invalid JSON", err);
    }

    if (!res.ok) {
      const msg = data.error?.message ?? `Vertex AI returned ${res.status}`;
      throw new AiError(`Vertex AI error: ${msg}`);
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new AiError("Vertex AI returned no candidates");
    }

    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      throw new AiError(`Vertex AI finished with reason: ${candidate.finishReason}`);
    }

    const text = candidate.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw new AiError("Vertex AI returned an empty response");
    }

    return text;
  }
}
