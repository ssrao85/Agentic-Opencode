FROM alpine:3.22 AS base

ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

RUN apk add --no-cache \
    libgcc \
    libstdc++ \
    ripgrep \
    sqlite \
    sqlite-dev \
    python3 \
    py3-pip \
    python3-dev \
    nodejs \
    npm \
    bash \
    git \
    curl \
    build-base \
    autoconf \
    automake \
    libtool \
    pkgconf \
    gettext-dev \
    glib-dev \
    libgsf-dev \
    gd-dev \
    zlib-dev

# Optional: make `python` command available too
RUN ln -sf /usr/bin/python3 /usr/local/bin/python

# Python environment
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN python3 -m venv ${VIRTUAL_ENV}

COPY requirements.txt /tmp/requirements.txt

RUN pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# Build libpst/readpst from source because Alpine does not provide Debian's pst-utils package
ARG LIBPST_TAG=libpst-0.6.76

RUN git clone --depth 1 --branch ${LIBPST_TAG} https://github.com/pst-format/libpst.git /tmp/libpst \
    && cd /tmp/libpst \
    && autopoint \
    && libtoolize --force --copy \
    && aclocal -I m4 \
    && autoheader \
    && automake --add-missing \
    && autoconf \
    && ./configure --prefix=/usr/local --enable-python=no \
    && make -C src -j"$(nproc)" \
    && cp src/readpst /usr/local/bin/readpst \
    && cp src/lspst /usr/local/bin/lspst \
    && cp src/pst2ldif /usr/local/bin/pst2ldif \
    && cp src/nick2ldif /usr/local/bin/nick2ldif \
    && chmod +x /usr/local/bin/readpst /usr/local/bin/lspst /usr/local/bin/pst2ldif /usr/local/bin/nick2ldif \
    && rm -rf /tmp/libpst

FROM base AS build-amd64
COPY dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

FROM base AS build-arm64
COPY dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}

RUN opencode --version \
    && sqlite3 --version \
    && python3 --version \
    && python --version \
    && pip --version \
    && node --version \
    && npm --version \
    && readpst -V

EXPOSE 3000

ENTRYPOINT ["opencode"]
CMD ["web", "--hostname", "0.0.0.0", "--port", "3000"]