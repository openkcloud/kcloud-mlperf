#!/bin/bash

cd "$(dirname "$0")"

helm install -n monitoring alloy -f values-override.yaml ./
