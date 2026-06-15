#!/bin/bash

cd "$(dirname "$0")"

helm install -n monitoring prometheus -f values-override.yaml ./
