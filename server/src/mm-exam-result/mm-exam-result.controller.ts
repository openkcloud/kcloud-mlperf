import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MmExamResultService } from './mm-exam-result.service';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import { UpdateMmExamResultDto } from './dto/update-mm-exam-result.dto';

@Controller('mm-exam-result')
export class MmExamResultController {
  constructor(private readonly resultService: MmExamResultService) {}

  // Mmlu exam result list
  @Get('list')
  findAll(@Query() query: PaginationQueryDto) {
    return this.resultService.findAll(query);
  }

  // Get exam result details
  @Get('details/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.resultService.findOne(id);
  }

  // Create mmlu exam result:  /mm-exam-result/create/120/3
  @Post('create/:examId/:repeat')
  create(
    @Param('examId', ParseIntPipe) examId: number,
    @Param('repeat', ParseIntPipe) repeat: number,
  ) {
    return this.resultService.create({
      examId,
      repeatCount: repeat,
    });
  }

  @Patch('update/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    updateMmExamResult: UpdateMmExamResultDto,
  ) {
    return this.resultService.update(id, updateMmExamResult);
  }

  @Delete('delete/:id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.resultService.remove(id);
  }
}
