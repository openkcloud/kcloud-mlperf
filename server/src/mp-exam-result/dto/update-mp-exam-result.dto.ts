import { PartialType } from '@nestjs/mapped-types';
import { CreateMpExamResultDto } from './create-mp-exam-result.dto';

export class UpdateMpExamResultDto extends PartialType(CreateMpExamResultDto) {}
