# Node 22.23.3 (.nvmrc), pnpm 10.33.4 (packageManager), Rust 1.90.0 (rust-toolchain.toml).
# Tauri library names match the Linux install in .github/workflows/ci.yml, plus libgtk-3-dev from the README.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ENV DEBIAN_FRONTEND=noninteractive \
    COREPACK_HOME=/home/dev/.corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    RUSTUP_HOME=/home/dev/.rustup \
    CARGO_HOME=/home/dev/.cargo \
    PATH=/home/dev/.cargo/bin:/usr/local/bin:${PATH}

RUN . /etc/os-release \
    && printf 'deb http://archive.ubuntu.com/ubuntu %s universe\ndeb http://archive.ubuntu.com/ubuntu %s-updates universe\ndeb http://security.ubuntu.com/ubuntu %s-security universe\n' \
        "$VERSION_CODENAME" "$VERSION_CODENAME" "$VERSION_CODENAME" \
        > /etc/apt/sources.list.d/universe.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        xz-utils \
        build-essential \
        pkg-config \
        file \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libxdo-dev \
        libssl-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        patchelf \
        libfuse2 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash --uid 1000 dev

# Checksums are the linux rows in scripts/sidecar-plan.ts.
ARG NODE_VERSION=22.23.3
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
        amd64) node_arch=x64; sha=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de ;; \
        arm64) node_arch=arm64; sha=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o /tmp/node.tar.xz \
    && echo "${sha}  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare pnpm@10.33.4 --activate \
    && node --version \
    && pnpm --version

# rustup 1.29.2. Checksums are the files published next to each rustup-init binary.
ARG RUSTUP_VERSION=1.29.2
RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
        amd64) triple=x86_64-unknown-linux-gnu; sha=5be191e8c70a5007074254cb74d78dbfdd25cd5a61c27de7b8e5410122ec24f4 ;; \
        arm64) triple=aarch64-unknown-linux-gnu; sha=a9c168dbea81a84671c6b7a5c1795cb0eb699020110d107ddfca427bd797e697 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${triple}/rustup-init" -o /tmp/rustup-init \
    && echo "${sha}  /tmp/rustup-init" | sha256sum -c - \
    && chmod +x /tmp/rustup-init \
    && /tmp/rustup-init -y --no-modify-path --default-toolchain 1.90.0 --profile minimal -c clippy -c rustfmt \
    && rm /tmp/rustup-init \
    && rustc --version \
    && chown -R dev:dev /home/dev

USER dev
WORKDIR /home/dev
