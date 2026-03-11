import { IsNumber, Min } from 'class-validator';

export class CreateMmExamResultDto {
  @IsNumber()
  @Min(0)
  exam_id: number;

  @IsNumber()
  @Min(0)
  result_number: number;

  @IsNumber()
  @Min(0)
  result_acc_total: number;

  @IsNumber()
  @Min(0)
  result_acc_physics: number;

  @IsNumber()
  @Min(0)
  result_acc_chemistry: number;

  @IsNumber()
  @Min(0)
  result_acc_law: number;

  @IsNumber()
  @Min(0)
  result_acc_engineering: number;

  @IsNumber()
  @Min(0)
  result_acc_other: number;

  @IsNumber()
  @Min(0)
  result_acc_economics: number;

  @IsNumber()
  @Min(0)
  result_acc_health: number;

  @IsNumber()
  @Min(0)
  result_acc_psychology: number;

  @IsNumber()
  @Min(0)
  result_acc_business: number;

  @IsNumber()
  @Min(0)
  result_acc_biology: number;

  @IsNumber()
  @Min(0)
  result_acc_philosophy: number;

  @IsNumber()
  @Min(0)
  result_acc_cs: number;

  @IsNumber()
  @Min(0)
  result_acc_history: number;
}
