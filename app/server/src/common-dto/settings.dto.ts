export interface SettingsDto {
  mlperf: {
    [key: string]: string[];
  };
  mmlu: {
    [key: string]: string[];
  };
}
