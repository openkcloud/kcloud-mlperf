import { PartialType } from '@nestjs/mapped-types';
import { CreateNpuExamDto } from './create-npu-exam.dto';

export class UpdateNpuExamDto extends PartialType(CreateNpuExamDto) {}
