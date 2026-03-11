#!/usr/bin/env bash

helm upgrade -n monitoring alloy -f values-override.yaml ./
