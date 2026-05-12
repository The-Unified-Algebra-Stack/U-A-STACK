// src/providers/OllamaProvider.ts

import axios, { AxiosInstance } from 'axios';

export interface OllamaConfig {
  model: string;
  prompt: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  num_ctx?: number;
  system?: string;
}

export interface OllamaResponse {
  response: string;
  model: string;
  created_at: string;
  done: boolean;
  total_duration: number;
  load_duration: number;
  prompt_eval_duration: number;
  eval_duration: number;
  eval_count: number;
  prompt_eval_count: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export class OllamaProvider {
  private client: AxiosInstance;
  private baseUrl: string;
  private healthCheckInterval: NodeJS.Timer | null = null;
  private isHealthy = false;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 120000 // 2 minutes for long generations
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.healthCheck();
      this.isHealthy = true;
      console.log('✓ Ollama provider initialized and healthy');
    } catch (error) {
      throw new Error(`Failed to initialize Ollama provider: ${error}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/tags', { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      throw new Error(`Ollama health check failed: ${error}`);
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.client.get<{ models: OllamaModel[] }>('/api/tags');
      return response.data.models || [];
    } catch (error) {
      throw new Error(`Failed to list Ollama models: ${error}`);
    }
  }

  async complete(config: OllamaConfig): Promise<OllamaResponse> {
    if (!this.isHealthy) {
      await this.initialize();
    }

    try {
      const response = await this.client.post<OllamaResponse>('/api/generate', {
        model: config.model,
        prompt: config.prompt,
        system: config.system,
        stream: false,
        temperature: config.temperature ?? 0.7,
        top_p: config.top_p ?? 0.9,
        top_k: config.top_k ?? 40,
        num_predict: config.num_predict ?? 512,
        num_ctx: config.num_ctx ?? 2048
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;

        if (status === 404) {
          throw new Error(
            `Model not found: ${config.model}. Available models: ${await this.listModels()
              .then(m => m.map(x => x.name).join(', '))
              .catch(() => 'unknown')}`
          );
        }

        throw new Error(`Ollama API error (${status}): ${message}`);
      }
      throw error;
    }
  }

  async streamComplete(
    config: OllamaConfig,
    onChunk: (chunk: string) => void,
    onDone?: (response: OllamaResponse) => void
  ): Promise<OllamaResponse> {
    if (!this.isHealthy) {
      await this.initialize();
    }

    try {
      const response = await this.client.post(
        '/api/generate',
        {
          model: config.model,
          prompt: config.prompt,
          system: config.system,
          stream: true,
          temperature: config.temperature ?? 0.7,
          top_p: config.top_p ?? 0.9,
          top_k: config.top_k ?? 40,
          num_predict: config.num_predict ?? 512,
          num_ctx: config.num_ctx ?? 2048
        },
        {
          responseType: 'stream'
        }
      );

      let fullResponse = '';
      let lastResponse: Partial<OllamaResponse> = {};

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            try {
              const data = JSON.parse(line) as Partial<OllamaResponse>;
              if (data.response) {
                onChunk(data.response);
                fullResponse += data.response;
              }
              lastResponse = data;
            } catch (e) {
              // Ignore parsing errors for incomplete JSON
            }
          }
        });

        response.data.on('end', () => {
          const finalResponse: OllamaResponse = {
            response: fullResponse,
            done: true,
            model: lastResponse.model || config.model,
            created_at: lastResponse.created_at || new Date().toISOString(),
            total_duration: lastResponse.total_duration || 0,
            load_duration: lastResponse.load_duration || 0,
            prompt_eval_duration: lastResponse.prompt_eval_duration || 0,
            eval_duration: lastResponse.eval_duration || 0,
            eval_count: lastResponse.eval_count || 0,
            prompt_eval_count: lastResponse.prompt_eval_count || 0
          };
          onDone?.(finalResponse);
          resolve(finalResponse);
        });

        response.data.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Ollama streaming error: ${error}`);
    }
  }

  async pullModel(modelName: string, onProgress?: (status: string) => void): Promise<void> {
    try {
      const response = await this.client.post(
        '/api/pull',
        { name: modelName },
        { responseType: 'stream', timeout: 3600000 } // 1 hour timeout for downloads
      );

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              onProgress?.(data.status);
            } catch (e) {
              // Ignore
            }
          }
        });

        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Failed to pull model ${modelName}: ${error}`);
    }
  }

  async deleteModel(modelName: string): Promise<void> {
    try {
      await this.client.delete('/api/delete', {
        data: { name: modelName }
      });
    } catch (error) {
      throw new Error(`Failed to delete model ${modelName}: ${error}`);
    }
  }
}
