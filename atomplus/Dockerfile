# vllm-rbln server for Rebellions Atom+ (RBLN-CA22) on K8s
#
# WHY THIS DOCKERFILE LOOKS UNUSUAL:
#   The vendor SDK `rebel-compiler` is published only on the auth-gated
#   pypi.rbln.ai index (not public PyPI, not wheels.vllm.ai).  We do NOT
#   have those credentials.  The same versions are already installed and
#   serving traffic on node5, so we package node5's existing site-packages
#   directly into the image.  This makes the image:
#     * byte-identical to the verified-running stack on the bare node, and
#     * reproducible without secrets — anyone with node5 ssh can rebuild it.
#
# Build context expects:
#   site-packages.tgz          -- tar -czf of node5:/usr/local/lib/python3.10/dist-packages
#   system-dist-packages.tgz   -- tar -czf of node5:/usr/lib/python3/dist-packages
#                                  (provides apt-installed yaml, idna, requests deps,
#                                   etc that node5's vllm stack imports)
#   vllm                       -- the /usr/local/bin/vllm wrapper script
#   entrypoint.sh              -- canonical vllm-rbln serve invocation
#
# Tag: ghcr.io/etri-llm/vllm-rbln-atomplus:0.9.3-llama3.1-8b
#
# BASE IMAGE: ubuntu:22.04 (NOT python:3.10-slim).  node5 is Ubuntu 22.04
# (jammy, glibc 2.35) and the rebel/torch shared objects in site-packages.tgz
# are linked against that exact ABI.  The upstream python:3.10-slim image is
# Debian trixie (glibc 2.41) AND uses /usr/local/lib/python3.10/site-packages
# instead of Debian's /usr/local/lib/python3.10/dist-packages — so the tarball
# extracts into a path the interpreter never searches.  Matching node5's
# distro fixes both issues simultaneously and keeps the image vendor-faithful.
FROM ubuntu:22.04

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    LD_LIBRARY_PATH=/usr/local/lib/python3.10/dist-packages/rebel_compiler.libs:/usr/local/lib/python3.10/dist-packages/torch/lib

# System python3.10 + runtime libraries the rebel/torch .so files link
# against.  libgomp1/libnuma1 are required by torch+rebel; tini supervises
# PID 1 so the kubelet's SIGTERM reaches the python process cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libgomp1 \
        libnuma1 \
        libstdc++6 \
        procps \
        python3 \
        python3-distutils \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Drop in node5's verified site-packages tree.  --strip-components=0 because
# the tarball was made with `tar -C /usr/local/lib/python3.10` so the top
# entry is already `dist-packages/`.  mkdir -p first so the destination
# exists even on minimal base images.
COPY site-packages.tgz /tmp/site-packages.tgz
RUN mkdir -p /usr/local/lib/python3.10 \
    && tar -xzf /tmp/site-packages.tgz -C /usr/local/lib/python3.10/ \
    && rm /tmp/site-packages.tgz

# Also drop in node5's apt-installed system dist-packages (yaml, idna,
# requests transitive deps, etc).  ubuntu:22.04 base image has a different
# subset than node5, so we overlay node5's exact tree to match the working
# import graph 1:1.
COPY system-dist-packages.tgz /tmp/system-dist-packages.tgz
RUN mkdir -p /usr/lib/python3 \
    && tar -xzf /tmp/system-dist-packages.tgz -C /usr/lib/python3/ \
    && rm /tmp/system-dist-packages.tgz

# vllm CLI wrapper that invokes vllm.entrypoints.openai.api_server.
COPY vllm /usr/local/bin/vllm
RUN chmod 0755 /usr/local/bin/vllm

# Sanity: prove vllm + rebel + vllm_rbln all import cleanly during build.
# If the layer mismatch breaks the image we want to know NOW, not in a
# CrashLoopBackOff.
RUN python3 -c "import vllm, vllm_rbln, optimum.rbln, rebel; print('vllm', vllm.__version__); print('vllm_rbln OK'); print('optimum.rbln OK'); print('rebel OK')"

# Non-root runtime user.  The rbln-device-plugin grants /dev/rbln* to
# unprivileged containers.
RUN groupadd --system --gid 10001 vllm \
    && useradd  --system --uid 10001 --gid 10001 --home /home/vllm --create-home vllm

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

USER vllm
WORKDIR /home/vllm

EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
