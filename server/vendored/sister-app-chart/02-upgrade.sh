#!/usr/bin/env bash

helm upgrade -n llm-evaluation app-chart -f values.yaml ./
