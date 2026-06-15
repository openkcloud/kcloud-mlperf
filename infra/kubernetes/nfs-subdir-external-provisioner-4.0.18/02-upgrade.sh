#!/usr/bin/env bash

helm upgrade -n nfs-provisioner nfs-subdir-external-provisioner -f values-override.yaml ./
