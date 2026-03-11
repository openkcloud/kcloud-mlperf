#!/usr/bin/env bash

helm upgrade -n loki loki -f values-override.yaml ./
