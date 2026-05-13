/**
 * ============================================================
 * OLLAMA BACKBONE - LOCAL LLM INTEGRATION
 * ============================================================
 *
 * Integrates Ollama (local LLM) as the backbone for:
 * - Language generation
 * - Semantic reasoning
 * - Knowledge retrieval
 * - Creative synthesis
 *
 * Works seamlessly with:
 * - Attention mechanisms
 * - Memory systems
 * - World models
 * - Speculative execution
 *
 * ============================================================
 */

import axios, { AxiosInstance } from 'axios';

interface OllamaConfig {
  baseURL?: string;
  model?: string;
  timeout?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  context?: number[];
  rawOutput?: boolean;
}

interface GenerationOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  stopSequences?: string[];
  maxTokens?: number;
}

interface OllamaResponse {
  response: string;
  model: string;
  done: boolean;
  context: number[];
  totalDuration: number;
  loadDuration: number;
  promptEvalDuration: number;
  evalDuration: number;
}

/**
 * OllamaBackbone: Local LLM inference engine
 * Handles all communication with Ollama service
 */
export class OllamaBackbone {
  private client: AxiosInstance;
  private baseURL: string;
  private model: string;
  private temperature: number;
  private topK: number;
  private topP: number;
  private context: number[];
  private rawOutput: boolean;

  constructor(config: OllamaConfig = {}) {
    this.baseURL = config.baseURL || 'http://localhost:11434';
    this.model = config.model || 'mistral';
    this.temperature = config.temperature ?? 0.7;
    this.topK = config.topK ?? 40;
    this.topP = config.topP ?? 0.9;
    this.context = config.context || [];
    this.rawOutput = config.rawOutput ?? false;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: config.timeout || 30000,
    });
  }

  /**
   * Check if Ollama service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/tags');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get list of available models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/api/tags');
      return response.data.models?.map((m: any) => m.name) || [];
    } catch (error) {
      console.error('Failed to fetch available models:', error);
      return [];
    }
  }

  /**
   * Generate text from prompt using Ollama
   */
  async generate(
    prompt: string,
    options: GenerationOptions = {}
  ): Promise<string> {
    try {
      const response = await this.client.post<OllamaResponse>(
        '/api/generate',
        {
          model: this.model,
          prompt,
          stream: false,
          temperature: options.temperature ?? this.temperature,
          top_k: options.topK ?? this.topK,
          top_p: options.topP ?? this.topP,
          num_predict: options.maxTokens ?? 512,
          context: this.context,
          raw: this.rawOutput,
        }
      );

      if (response.data.done) {
        this.context = response.data.context;
        return response.data.response.trim();
      }

      throw new Error('Ollama generation incomplete');
    } catch (error) {
      console.error('Ollama generation failed:', error);
      throw error;
    }
  }

  /**
   * Generate with streaming (for long outputs)
   */
  async *generateStreaming(
    prompt: string,
    options: GenerationOptions = {}
  ): AsyncGenerator<string> {
    try {
      const response = await this.client.post('/api/generate', {
        model: this.model,
        prompt,
        stream: true,
        temperature: options.temperature ?? this.temperature,
        top_k: options.topK ?? this.topK,
        top_p: options.topP ?? this.topP,
        num_predict: options.maxTokens ?? 512,
        context: this.context,
        raw: this.rawOutput,
      });

      for await (const chunk of response.data) {
        const line = chunk.toString().trim();
        if (line) {
          const json = JSON.parse(line);
          if (json.response) {
            yield json.response;
          }
          if (json.done) {
            this.context = json.context;
          }
        }
      }
    } catch (error) {
      console.error('Ollama streaming failed:', error);
      throw error;
    }
  }

  /**
   * Embed text using Ollama embeddings endpoint
   */
  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.client.post('/api/embed', {
        model: this.model,
        input: text,
      });

      return response.data.embedding || [];
    } catch (error) {
      console.error('Ollama embedding failed:', error);
      return [];
    }
  }

  /**
   * Chat interface (multi-turn conversation)
   */
  async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    try {
      const response = await this.client.post('/api/chat', {
        model: this.model,
        messages,
        stream: false,
        temperature: this.temperature,
        top_k: this.topK,
        top_p: this.topP,
      });

      return response.data.message?.content || '';
    } catch (error) {
      console.error('Ollama chat failed:', error);
      throw error;
    }
  }

  /**
   * Reset context for fresh conversation
   */
  resetContext(): void {
    this.context = [];
  }

  /**
   * Set model to use
   */
  setModel(model: string): void {
    this.model = model;
    this.context = [];
  }

  /**
   * Update generation parameters
   */
  setParameters(config: Partial<OllamaConfig>): void {
    if (config.temperature !== undefined) this.temperature = config.temperature;
    if (config.topK !== undefined) this.topK = config.topK;
    if (config.topP !== undefined) this.topP = config.topP;
  }
}
