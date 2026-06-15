import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import path from 'path';
import { SettingsDto } from '../common-dto/settings.dto';
@Injectable()
export class FilesService {
  getDatasetsFiles() {
    try {
      const rootPath = path.join(
        process.cwd(), // root folder of the project
        'mnt',
        'datasets',
      );
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });

      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'folder' : 'file',
      }));
    } catch (error) {
      throw new HttpException('' + error?.message, HttpStatus.NOT_FOUND);
    }
  }

  getModelFiles() {
    try {
      const rootPath = path.join(
        process.cwd(), // root folder of the project
        'mnt',
        'models',
      );
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });

      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'folder' : 'file',
      }));
    } catch (error) {
      throw new HttpException('' + error?.message, HttpStatus.NOT_FOUND);
    }
  }
  getSettings(): SettingsDto {
    try {
      const rootPath = path.join(
        process.cwd(), // root folder of the project
        'mnt',
        'datasets',
        'settings.json',
      );
      const settings = fs.readFileSync(rootPath, 'utf8');
      return JSON.parse(settings) as SettingsDto;
    } catch (error) {
      throw new HttpException('' + error?.message, HttpStatus.NOT_FOUND);
    }
  }
}
