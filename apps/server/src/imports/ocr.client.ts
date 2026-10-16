import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { config } from '../config';
import { z } from 'zod';
import { parseResultSchema } from '@canglin/shared';

const textModeSchema = parseResultSchema.extend({ textLayer: z.union([z.string(), z.literal(false)]) });
const stripsSchema = z.object({ mime: z.string().startsWith('image/'), images: z.array(z.string()).min(1).max(3) });
@Injectable()
export class OcrClient {
  private form(file: Buffer, filename: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), filename);
    return form;
  }
  private async request(endpoint: string, file: Buffer, filename: string, binary = false) {
    return (await this.post(endpoint, file, filename, binary)).data;
  }
  private async post(endpoint: string, file: Buffer, filename: string, binary = false) {
    try {
      return await axios.post(
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
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? (error.response?.data?.detail ?? 'OCR 服务不可用或超时')
        : 'OCR 响应错误';
      throw new ServiceUnavailableException(`原件识别失败：${detail}`);
    }
  }
  async parse(file: Buffer, filename: string, page?: number) {
    return parseResultSchema.parse(
      await this.request(`parse${page ? `?page=${page}` : ''}`, file, filename),
    );
  }
  /** 只读文本层与网格重建（mode=text），不渲染、不 OCR；textLayer 为本页正文，没有文本层时为 null */
  async textLayer(file: Buffer, filename: string, page: number) {
    const value = textModeSchema.parse(await this.request(`parse?page=${page}&mode=text`, file, filename));
    const { textLayer, ...result } = value;
    return { result: parseResultSchema.parse(result), textLayer: textLayer || null };
  }
  async inspect(file: Buffer, filename: string): Promise<{ pageCount: number }> {
    const value = await this.request('inspect', file, filename);
    if (!Number.isInteger(value.pageCount) || value.pageCount < 1 || value.pageCount > 30)
      throw new ServiceUnavailableException('页数无效或超过 30 页，请拆分上传');
    return { pageCount: value.pageCount };
  }
  /** 送模型与人工查看的页图：照片已转正、缩放并转 JPEG，截图与 PDF 页为 PNG；以服务返回的类型为准 */
  async page(file: Buffer, filename: string, page: number): Promise<{ bytes: Buffer; mime: string }> {
    const response = await this.post(`page?page=${page}`, file, filename, true);
    const mime = String(response.headers['content-type'] ?? '').split(';')[0].trim();
    return { bytes: Buffer.from(response.data), mime: mime.startsWith('image/') ? mime : 'image/png' };
  }
  /** 长截图自上而下切成 1 到 3 段（只切在空白带），每段与 page() 同样预处理 */
  async pageStrips(file: Buffer, filename: string, page: number): Promise<{ mime: string; images: Buffer[] }> {
    const value = stripsSchema.parse(await this.request(`page?page=${page}&strips=1`, file, filename));
    return { mime: value.mime, images: value.images.map((image) => Buffer.from(image, 'base64')) };
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
