export type FileList = {
  name: string;
  type: 'folder' | 'file';
};

export type Settings = {
  mlperf: {
    [key: string]: string[];
  };
  mmlu: {
    [key: string]: string[];
  };
};
