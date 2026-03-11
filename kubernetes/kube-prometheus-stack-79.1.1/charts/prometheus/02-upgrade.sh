#!/usr/bin/env bash

helm upgrade -n monitoring prometheus -f values-override.yaml ./
