import { useMemo } from 'react';

import { isEmpty } from 'lodash';

import type { GpuList } from '@/api/types/common.types';

type SelectValue = {
  label: string;
  value: string | number;
};

export const useGpuModel = (config: {
  gpuList: { gpus: GpuList[] } | undefined;
  selectedGpuType: SelectValue;
}) => {
  const { gpuList, selectedGpuType } = config;

  const { gpuTypes, gpuNumbers } = useMemo(() => {
    if (!gpuList || isEmpty(gpuList)) {
      return { gpuTypes: [], gpuNumbers: [] };
    }

    const hasSelectedGpuType = Boolean(selectedGpuType.value);

    const { gpus } = gpuList;
    const gpuTypes: SelectValue[] = gpus.map(item => ({
      label: item.gpuModel,
      value: item.gpuModel
    }));

    let gpuNumbers: Array<{ value: number; label: string }> = [];

    if (hasSelectedGpuType) {
      const selectedGpuItem = gpus.find(item => item.gpuModel === selectedGpuType.value);
      if (selectedGpuItem) {
        const newGpuNums: Array<{ label: string; value: number }> = [];
        for (let i = 0; i < selectedGpuItem.gpuCount; i++) {
          newGpuNums.push({
            label: `${i + 1}`,
            value: i + 1
          });
        }

        gpuNumbers = newGpuNums;
      }
    }

    return { gpuTypes, gpuNumbers };
  }, [gpuList, selectedGpuType]);

  return { gpuTypes, gpuNumbers };
};
