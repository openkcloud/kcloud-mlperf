import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { type Response } from 'express';
import { MpExamResultService } from './mp-exam-result.service';
import { TestScenarioEnum } from '../enums/test-scenario.enum';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import { MpExamModeEnum } from 'src/enums/mp-exam-mode.enum';

@Controller('mp-exam-result')
export class MpExamResultController {
  constructor(private readonly examService: MpExamResultService) {}

  // Create mmlu exam result:  /mp-exam-result/create
  @Post('create')
  create(
    @Body()
    body: {
      exam_id: number;
      repeat_count: number;
      scenario: TestScenarioEnum;
      mode: MpExamModeEnum;
    },
  ) {
    return this.examService.create({
      examId: body.exam_id,
      repeatCount: body.repeat_count,
      testScenario: body.scenario,
      mode: body.mode,
    });
  }

  // Get all list
  @Get('list')
  findAll(@Query() query: PaginationQueryDto) {
    return this.examService.findAll(query);
  }

  // Exam result details
  @Get('details/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.examService.findOne(id);
  }

  // Get source files
  @Get('exam-result/:id/:repeatCount/download')
  getExamResult(
    @Param('id', ParseIntPipe) id: number,
    @Param('repeatCount', ParseIntPipe) repeatCount: number,
    @Res() res: Response,
  ) {
    const filePath = this.examService.getExamResultPath(id, repeatCount);

    res.download(filePath, 'exam_result.zip', (error) => {
      if (error) {
        res.status(404).send(error.message);
      }
    });
  }

  // Get exam submission report
  @Get('exam-submission/:id/:repeatCount/download')
  getExamSubmissionReport(
    @Param('id', ParseIntPipe) id: number,
    @Param('repeatCount', ParseIntPipe) repeatCount: number,
    @Res() res: Response,
  ) {
    const filePath = this.examService.getSubmissionReportPath(id, repeatCount);

    res.download(filePath, 'submission_report.zip', (error) => {
      if (error) {
        res.status(404).send(error.message);
      }
    });
  }
}
