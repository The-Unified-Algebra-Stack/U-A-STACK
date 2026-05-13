/**
 * ============================================================
 * OLLAMA BACKBONE FOR UNIFIED INTELLIGENCE SYSTEM
 * ============================================================
 *
 * Integrates local Ollama LLM with the intelligence core.
 * Handles generation, embeddings, chat, and streaming.
 *
 * ============================================================
 */

import axios, { AxiosInstance } from 'axios';

export interface GenerationOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  timeout?: number;
}

export interface OllamaConfig {
  baseURL?: string;
  model?: string;
  temperature?: number;
  topK?: number;
  topP?: number;
  timeout?: number;
}

export class OllamaBackbone {
  private client: AxiosInstance;
  private model: string;
  private temperature: number;
  private topK: number;
  private topP: number;
  private context: any[] = [];
  private timeout: number;

  constructor(config: OllamaConfig = {}) {
    const {
      baseURL = 'http://localhost:11434',
      model = 'mistral',
      temperature = 0.7,
      topK = 40,
      topP = 0.9,
      timeout = 30000,
    } = config;

    this.client = axios.create({ baseURL });
    this.model = model;
    this.temperature = temperature;
    this.topK = topK;
    this.topP = topP;
    this.timeout = timeout;
  }

  /**
   * Generate text from prompt
   */
  async generate(
    prompt: string,
    options: GenerationOptions = {}
  ): Promise<string> {
    try {
      const response = await this.client.post(
        '/api/generate',
        {
          model: this.model,
          prompt,
          stream: false,
          temperature: options.temperature ?? this.temperature,
          top_k: options.topK ?? this.topK,
          top_p: options.topP ?? this.topP,
        },
        { timeout: options.timeout ?? this.timeout }
      );

      return response.data.response;
    } catch (error: any) {
      throw new Error(
        `Ollama generation failed: ${error.message}`
      );
    }
  }

  /**
   * Stream generation for long-form outputs
   */
  async *generateStreaming(
    prompt: string,
    options: GenerationOptions = {}
  ): AsyncGenerator<string> {
    try {
      const response = await this.client.post(
        '/api/generate',
        {
          model: this.model,
          prompt,
          stream: true,
          temperature: options.temperature ?? this.temperature,
          top_k: options.topK ?? this.topK,
          top_p: options.topP ?? this.topP,
        },
        {
          timeout: options.timeout ?? this.timeout,
          responseType: 'stream',
        }
      );

      for await (const chunk of response.data) {
        const line = chunk.toString().trim();
        if (line) {
          const parsed = JSON.parse(line);
          yield parsed.response;
        }
      }
    } catch (error: any) {
      throw new Error(
        `Ollama streaming failed: ${error.message}`
      );
    }
  }

  /**
   * Generate embeddings for text
   */
  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.client.post(
        '/api/embeddings',
        {
          model: this.model,
          prompt: text,
        },
        { timeout: this.timeout }
      );

      return response.data.embedding;
    } catch (error: any) {
      throw new Error(
        `Ollama embedding failed: ${error.message}`
      );
    }
  }

  /**
   * Chat with context management
   */
  async chat(
    messages: Array<{ role: string; content: string }>
  ): Promise<string> {
    try {
      const response = await this.client.post(
        '/api/chat',
        {
          model: this.model,
          messages,
          stream: false,
        },
        { timeout: this.timeout }
      );

      return response.data.message.content;
    } catch (error: any) {
      throw new Error(`Ollama chat failed: ${error.message}`);
    }
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.get('/api/tags', {
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/api/tags', {
        timeout: this.timeout,
      });
      return response.data.models.map(
        (m: any) => m.name
      );
    } catch (error: any) {
      throw new Error(
        `Failed to get models: ${error.message}`
      );
    }
  }

  /**
   * Reset conversation context
   */
  resetContext(): void {
    this.context = [];
  }

  /**
   * Set active model
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokenCount(text: string): number {
    // Rough heuristic: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate with token limit
   */
  async generateWithLimit(
    prompt: string,
    maxTokens: number = 1000
  ): Promise<string> {
    const generatedTokens = 0;
    let result = '';

    for await (const chunk of this.generateStreaming(prompt)) {
      result += chunk;
      const tokens = this.estimateTokenCount(result);

      if (tokens >= maxTokens) {
        break;
      }
    }

    return result;
  }
}

export default OllamaBackbone;
