#!/usr/bin/env bash

helm upgrade -n monitoring grafana -f values-override.yaml ./
