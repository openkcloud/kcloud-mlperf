import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  ParseIntPipe,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { CreateMpExamDto } from './dto/create-mp-exam.dto';
import { MpExamService } from './mp-exam.service';
import { UpdateMpExamDto } from './dto/update-mp-exam.dto';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';

@Controller('mp-exam')
export class MpExamController {
  constructor(private readonly mpExamService: MpExamService) {}

  @Get('gpu-list')
  getGpuList() {
    return this.mpExamService.getAvailableGpuList();
  }

  @Get('status/:id')
  getStatus(@Param('id', ParseIntPipe) id: number) {
    return this.mpExamService.getMpExamStatus(id);
  }

  @Get('list')
  findAll(@Query() query: PaginationQueryDto) {
    return this.mpExamService.findAll(query);
  }

  @Get('details/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.mpExamService.findOne(id);
  }

  @Patch('start-time/:id')
  updateStartTime(@Param('id', ParseIntPipe) id: number) {
    return this.mpExamService.updateMpExamStartTime(id);
  }

  @Patch('stop/:id')
  stopExam(@Param('id', ParseIntPipe) id: number) {
    return this.mpExamService.stopMpExam(id);
  }

  @Post('create')
  create(@Body() body: CreateMpExamDto) {
    return this.mpExamService.create(body);
  }

  @Patch('update/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    updateMpExamDto: UpdateMpExamDto,
  ) {
    return this.mpExamService.update(id, updateMpExamDto);
  }

  @Delete('delete/:id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.mpExamService.remove(id);
  }
}
