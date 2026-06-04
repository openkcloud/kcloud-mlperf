import { useQuery } from '@tanstack/react-query';

import { FilesApi } from '@/api/domains/files.domains';

import { FilesQueryKeys } from '@/contexts/QueryContext/query.keys.ts';

// F4: heuristic to keep only real model directories. `/files/models` returns
// every subdir under /mnt/models, which includes cache/temp dirs like
// `.hf_cache`, `.tmp_rbln`, and quant scratch dirs like `atom_quant_bench`.
const MODEL_KEYWORDS = /(llama|qwen|deepseek|mistral|gemma|phi|falcon|mixtral|gpt)/i;

const isLikelyModel = (entry: { name: string; type?: 'folder' | 'file' }): boolean => {
  if (!entry?.name) return false;
  // Filter dot-prefix dirs (cache/temp).
  if (entry.name.startsWith('.')) return false;
  // Files (e.g. README) are never models.
  if (entry.type === 'file') return false;
  // Keep anything matching the canonical-model keyword list. Anything else
  // (quant benches, intermediate dirs) is dropped.
  return MODEL_KEYWORDS.test(entry.name);
};

export const useModelsList = () => {
  const { data = [], refetch } = useQuery({
    queryKey: FilesQueryKeys.models(),
    queryFn: FilesApi.models,
    staleTime: Infinity
  });

  return {
    models: data
      .filter(isLikelyModel)
      .map(model => ({ label: model.name, value: model.name })),
    refetchModels: refetch
  };
};
