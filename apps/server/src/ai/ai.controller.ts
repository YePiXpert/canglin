import { capabilityImage } from './capability-image';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  aiAskSchema,
  aiConfigSchema,
  type AiAskInput,
  type AiConfigInput,
} from '@canglin/shared';
import { config } from '../config';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp } from '../common/request.util';
import { AiService } from './ai.service';
import { AiConfigService } from './ai-config.service';
import { LlmClient } from './llm.client';

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly aiConfig: AiConfigService,
    private readonly llm: LlmClient,
  ) {}

  @Get('config')
  async getConfig() {
    return this.aiConfig.view(await this.aiConfig.getConfig());
  }

  @Put('config')
  @HttpCode(200)
  async updateConfig(
    @Body(new ZodValidationPipe(aiConfigSchema)) body: AiConfigInput,
    @Req() req: FastifyRequest,
  ) {
    const stored = await this.aiConfig.updateConfig(body, clientIp(req));
    return this.aiConfig.view(stored);
  }

  @Get('health')
  async health() {
    const cfg = await this.aiConfig.getConfig();
    if (!(cfg.enabled && cfg.apiKey)) return { ok: false, reason: 'not-configured' };
    return { ok: await this.llm.ping(cfg.baseUrl, cfg.apiKey, cfg.model) };
  }

  @Get('models')
  async models() {
    const cfg = await this.aiConfig.getConfig();
    if (!cfg.apiKey) throw new BadRequestException('请先配置服务密钥，再获取模型列表');
    const available = await this.llm.listModels(cfg.baseUrl, cfg.apiKey);
    // 有允许列表时只回列表里服务商也提供的模型；不限制时原样返回
    const allowed = config.llmAllowedModels;
    return { models: allowed ? allowed.map((m) => m.id).filter((id) => available.includes(id)) : available };
  }

  @Post('capabilities')
  async capabilities() {
    const cfg = await this.aiConfig.getConfig();
    const result = {
      checkedAt: new Date().toISOString(),
      text: false,
      image: false,
      structured: false,
      tools: false,
    };
    const base = {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: 512,
      timeoutMs: 30000,
    };
    result.text = await this.llm.ping(cfg.baseUrl, cfg.apiKey, cfg.model);
    try {
      const image = await this.llm.chat({
        ...base,
        messages: [
          {
            role: 'user',
            content:
              'Name the left and right colors. Reply RED_BLUE if left is red and right is blue.',
            images: [capabilityImage()],
          },
        ],
      });
      result.image = image.content?.trim() === 'RED_BLUE';
    } catch {
      /* each capability is independently reported */
    }
    try {
      const schema = {
        type: 'object',
        properties: { value: { type: 'integer', enum: [7] } },
        required: ['value'],
        additionalProperties: false,
      };
      const value = await this.llm.chat({
        ...base,
        schema,
        messages: [{ role: 'user', content: 'Return value 7.' }],
      });
      result.structured = JSON.stringify(JSON.parse(value.content || '{}')) === '{"value":7}';
    } catch {
      /* report unsupported schema */
    }
    try {
      const first = await this.llm.chat({
        ...base,
        messages: [{ role: 'user' as const, content: 'Call capability_check with value 7.' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'capability_check',
              description: 'Required capability test',
              parameters: {
                type: 'object',
                properties: { value: { type: 'integer' } },
                required: ['value'],
                additionalProperties: false,
              },
            },
          },
        ],
      });
      const call = first.toolCalls[0];
      if (call?.name === 'capability_check' && (call.args as { value?: number }).value === 7) {
        const second = await this.llm.chat({
          ...base,
          messages: [
            { role: 'user', content: 'Call capability_check and repeat its result exactly.' },
            { role: 'assistant', content: null, responseItems: first.outputItems },
            { role: 'tool', tool_call_id: call.id, content: 'CAPABILITY_OK' },
          ],
        });
        result.tools = second.content?.trim() === 'CAPABILITY_OK';
      }
    } catch {
      /* report incomplete tool roundtrip */
    }
    await this.aiConfig.saveCapabilities(cfg, result);
    return result;
  }

  @Post('ask')
  ask(@Body(new ZodValidationPipe(aiAskSchema)) body: AiAskInput, @Req() req: FastifyRequest) {
    return this.ai.ask(body, clientIp(req));
  }

}
