import { Controller, Get } from '@nestjs/common';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get('datasets')
  getDatasets() {
    return this.filesService.getDatasetsFiles();
  }

  @Get('models')
  getModelFiles() {
    return this.filesService.getModelFiles();
  }
  @Get('settings')
  getSettings() {
    return this.filesService.getSettings();
  }
}
