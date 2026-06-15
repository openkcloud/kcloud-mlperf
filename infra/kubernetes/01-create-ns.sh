#!/usr/bin/env bash

# 생성할 네임스페이스 목록 배열 정의
NAMESPACES=(
    "monitoring"
    "etri-llm"
    "gpu-operator"
    "loki"
    "nfs-provisioner"
)

for ns in "${NAMESPACES[@]}"; do
    # 네임스페이스가 존재하는지 확인 (에러 메시지는 /dev/null로 버림)
    if kubectl get ns "$ns" > /dev/null 2>&1; then
        echo "Namespace '$ns' already exists. Skipping..."
    else
        kubectl create ns "$ns"
        echo "Namespace '$ns' created."
    fi
done