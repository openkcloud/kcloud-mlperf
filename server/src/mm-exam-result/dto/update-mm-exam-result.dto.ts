import { PartialType } from '@nestjs/mapped-types';
import { CreateMmExamResultDto } from './create-mm-exam-result.dto';

export class UpdateMmExamResultDto extends PartialType(CreateMmExamResultDto) {}
