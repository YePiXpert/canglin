import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportRecognitionService } from './import-recognition.service';
import { OcrClient } from './ocr.client';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, ImportRecognitionService, OcrClient],
  exports: [OcrClient, ImportsService, ImportRecognitionService],
})
export class ImportsModule {}
