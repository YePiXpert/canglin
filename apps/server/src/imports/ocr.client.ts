import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { config } from '../config';
import { parseResultSchema } from '@canglin/shared';
@Injectable()
export class OcrClient {
  private form(file: Buffer, filename: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), filename);
    return form;
  }
  private async request(endpoint: string, file: Buffer, filename: string, binary = false) {
    try {
      const result = await axios.post(
        `${config.ocrBaseUrl}/${endpoint}`,
        this.form(file, filename),
        {
          headers: { 'X-API-Key': config.ocrApiKey },
          timeout: 180_000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          responseType: binary ? 'arraybuffer' : 'json',
        },
      );
      return result.data;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? (error.response?.data?.detail ?? 'OCR 服务不可用或超时')
        : 'OCR 响应错误';
      throw new ServiceUnavailableException(`单据解析失败：${detail}`);
    }
  }
  async parse(file: Buffer, filename: string, page?: number) {
    return parseResultSchema.parse(
      await this.request(`parse${page ? `?page=${page}` : ''}`, file, filename),
    );
  }
  async inspect(file: Buffer, filename: string): Promise<{ pageCount: number }> {
    const value = await this.request('inspect', file, filename);
    if (!Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 30)
      throw new ServiceUnavailableException('页数无效或超过 30 页，请拆分上传');
    return { pageCount: value.pageCount };
  }
  async page(file: Buffer, filename: string, page: number): Promise<Buffer> {
    return Buffer.from(await this.request(`page?page=${page}`, file, filename, true));
  }
  async health(): Promise<boolean> {
    try {
      await axios.get(`${config.ocrBaseUrl}/ready`, {
        headers: { 'X-API-Key': config.ocrApiKey },
        timeout: 30_000,
      });
      return true;
    } catch {
      return false;
    }
  }
}
