ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.23
FROM ${UV_IMAGE} AS uv

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
    zlib-dev \
    zlib \
    icu-libs \
    krb5-libs \
    tzdata \
    ca-certificates \
    # dotnet8-sdk \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    poppler-utils \
    fontconfig \
    font-dejavu \
    font-liberation \
    font-noto \
    font-noto-cjk \
    pango \
    harfbuzz \
    libffi-dev \
    libjpeg-turbo-dev \
    openjpeg-dev \
    openjdk17-jre-headless


# LibreOffice/xlsx skill fix without changing opencode HOME/XDG/db paths.
# Keep HOME=/ so opencode DB/config behavior does not change.
# The xlsx recalc helper writes macros under HOME/.config/libreoffice/4,
# so LibreOffice must use the same UserInstallation path.
ENV SAL_USE_VCLPLUGIN=svp

RUN chmod 1777 /tmp \
    && mkdir -p /.cache \
    &&  chmod 1777 /.cache \
    && mkdir -p \
      /tmp/opencode \
      /.config/libreoffice/4 \
    && chgrp -R 0 /tmp/opencode /.config/libreoffice \
    && chmod -R g=u /tmp/opencode /.config/libreoffice \
    && chmod -R a+rwX /tmp/opencode /.config/libreoffice \
    && fc-cache -f

RUN cat > /usr/local/bin/soffice <<'EOF'
#!/bin/sh
set -eu

export SAL_USE_VCLPLUGIN="${SAL_USE_VCLPLUGIN:-svp}"

home="${HOME:-/}"

if [ "$home" = "/" ]; then
  LO_PROFILE="/.config/libreoffice/4"
else
  LO_PROFILE="${home%/}/.config/libreoffice/4"
fi

mkdir -p "$LO_PROFILE"

rm -f "$LO_PROFILE/.lock" 2>/dev/null || true
find "$LO_PROFILE" -name ".~lock*" -delete 2>/dev/null || true

exec /usr/bin/soffice \
  -env:UserInstallation="file://${LO_PROFILE}" \
  "$@"
EOF

RUN chmod +x /usr/local/bin/soffice \
    && ln -sf /usr/local/bin/soffice /usr/local/bin/libreoffice

ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
ENV DOTNET_NOLOGO=true
ENV DOTNET_SKIP_FIRST_TIME_EXPERIENCE=true
ENV DOTNET_CLI_HOME=/tmp/dotnet
ENV NUGET_PACKAGES=/tmp/nuget-packages

RUN mkdir -p /tmp/dotnet /tmp/nuget-packages && \
    chgrp -R 0 /tmp/dotnet /tmp/nuget-packages && \
    chmod -R g=u /tmp/dotnet /tmp/nuget-packages

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g playwright docx pptxgenjs

# Install uv and uvx from the official uv image
COPY --from=uv /uv /uvx /usr/local/bin/

# Optional: make `python` command available too
RUN ln -sf /usr/bin/python3 /usr/local/bin/python

# Python environment
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN python3 -m venv ${VIRTUAL_ENV}

COPY requirements.txt /tmp/requirements.txt

RUN uv pip install --python ${VIRTUAL_ENV}/bin/python --upgrade pip setuptools wheel \
    && uv pip install --python ${VIRTUAL_ENV}/bin/python --no-cache -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# Allow OpenShift arbitrary UID users, usually in group 0, to write to the venv
RUN chgrp -R 0 ${VIRTUAL_ENV} \
    && chmod -R g=u ${VIRTUAL_ENV} \
    && find ${VIRTUAL_ENV} -type d -exec chmod g+s {} +

# Also allow OpenShift random UID users to write .NET/NuGet caches
RUN chgrp -R 0 /tmp/dotnet /tmp/nuget-packages \
    && chmod -R g=u /tmp/dotnet /tmp/nuget-packages

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

# `apps` helper: manages the /apps/<name>/* registry opencode proxies to.
COPY container/apps /usr/local/bin/apps
RUN chmod +x /usr/local/bin/apps

# Deployed Apps dashboard, shown in the opencode sidebar. The entrypoint launches
# it as the `dashboard` app so it is served at /apps/dashboard/.
COPY container/dashboard /opt/opencode-dashboard

# Deploy-app skill, available to every workspace. opencode scans
# $HOME/.agents/skills/**/SKILL.md as global skills, and HOME=/ in this image.
COPY container/skills /.agents/skills
#COPY skills /skills

# Entrypoint wrapper: relaunch persisted apps (apps restore) before opencode.
COPY container/entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint
ENV OPENCODE_APPS_AUTO_RESTORE=true
# HOME=/ is not writable for OpenShift's random UID; give npm (plugin installs at
# runtime) a cache it can write. Set late so it does not invalidate the cached layers above.
ENV NPM_CONFIG_CACHE=/tmp/.npm
ENV OPENCODE_SERVER_MODE=web

FROM base AS build-amd64
COPY dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

FROM base AS build-arm64
COPY dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}

# Traceability: `docker build --build-arg REVISION=$(git rev-parse --short HEAD)`.
ARG REVISION=unknown
LABEL org.opencontainers.image.title="opencode" \
      org.opencontainers.image.revision="${REVISION}"

RUN opencode --version \
    && sqlite3 --version \
    && python3 --version \
    && python --version \
    && pip --version \
    && uv --version \
    && node --version \
    && npm --version \
    #&& dotnet --info \
    #&& dotnet --list-sdks \
    && libreoffice --headless --version \
    && soffice --headless --version \
    && pdftoppm -v \
    && pdfinfo -v \
    && readpst -V

EXPOSE 3000

ENTRYPOINT ["opencode-entrypoint"]
CMD ["--hostname", "0.0.0.0", "--port", "3000"]
