#!/bin/bash

helm install -n monitoring grafana -f values-override.yaml ./
