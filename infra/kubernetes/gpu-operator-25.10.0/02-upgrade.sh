#!/usr/bin/env bash

helm upgrade -n gpu-operator gpu-operator -f values-override.yaml ./
