#!/bin/bash

cd "$(dirname "$0")"

helm install -n loki loki -f values-override.yaml ./
