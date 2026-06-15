import { CreateMmExamDto } from './create-mm-exam.dto';
import { PartialType } from '@nestjs/mapped-types';

export class UpdateMmExamDto extends PartialType(CreateMmExamDto) {}
