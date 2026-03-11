import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MmExamService } from './mm-exam.service';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import { CreateMmExamDto } from './dto/create-mm-exam.dto';
import { UpdateMmExamDto } from './dto/update-mm-exam.dto';

@Controller('mm-exam')
export class MmExamController {
  constructor(private readonly mmExamService: MmExamService) {}

  @Get('gpu-list')
  getGpuList() {
    return this.mmExamService.getAvailableGpuList();
  }

  @Get('list')
  findAll(@Query() query: PaginationQueryDto) {
    return this.mmExamService.findAll(query);
  }

  @Get('status/:id')
  getStatus(@Param('id', ParseIntPipe) id: number) {
    return this.mmExamService.getExamStatus(id);
  }

  @Get('details/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.mmExamService.findOne(id);
  }

  @Post('create')
  create(@Body() body: CreateMmExamDto) {
    return this.mmExamService.create(body);
  }

  @Patch('start-time/:id')
  updateStartTime(@Param('id', ParseIntPipe) id: number) {
    return this.mmExamService.updateExamStartTime(id);
  }

  @Patch('stop/:id')
  stopExam(@Param('id', ParseIntPipe) id: number) {
    return this.mmExamService.stop(id);
  }

  @Patch('update/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    updateMpExamDto: UpdateMmExamDto,
  ) {
    return this.mmExamService.update(id, updateMpExamDto);
  }

  @Delete('delete/:id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.mmExamService.remove(id);
  }
}
