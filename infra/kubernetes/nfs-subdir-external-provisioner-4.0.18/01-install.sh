#!/bin/bash

cd "$(dirname "$0")"

helm install -n nfs-provisioner nfs-subdir-external-provisioner -f values-override.yaml ./
