#!/bin/bash

cd "$(dirname "$0")"

helm install -n llm-evaluation app-chart -f values.yaml ./
