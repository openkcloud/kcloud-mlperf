#!/bin/bash

cd "$(dirname "$0")"

helm install -n gpu-operator gpu-operator -f values-override.yaml ./
