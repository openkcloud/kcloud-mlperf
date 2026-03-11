import { PartialType } from '@nestjs/mapped-types';
import { CreateMpExamDto } from './create-mp-exam.dto';

export class UpdateMpExamDto extends PartialType(CreateMpExamDto) {}
