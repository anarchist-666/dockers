ARG DEBIAN_VERSION=bookworm-slim

FROM debian:${DEBIAN_VERSION} AS builder

ARG ASTERISK_VERSION=22-current
ARG ASTERISK_MIRROR=https://downloads.asterisk.org/pub/telephony/asterisk
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config ca-certificates curl wget bzip2 xz-utils patch \
      libssl-dev libxml2-dev libxslt1-dev libsqlite3-dev uuid-dev libedit-dev \
      libncurses-dev libcurl4-openssl-dev libsrtp2-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/asterisk

RUN set -eux; \
    curl -fsSL "${ASTERISK_MIRROR}/asterisk-${ASTERISK_VERSION}.tar.gz" \
      | tar -xz --strip-components=1; \
    ./configure \
      --prefix=/usr --sysconfdir=/etc --localstatedir=/var --libdir=/usr/lib \
      --with-pjproject-bundled --with-jansson-bundled; \
    make menuselect.makeopts; \

    menuselect/menuselect \
      --disable BUILD_NATIVE \
      --enable CORE-SOUNDS-EN-ULAW --enable CORE-SOUNDS-EN-ALAW --enable CORE-SOUNDS-EN-GSM \
      --enable MOH-OPSOUND-ULAW   --enable MOH-OPSOUND-ALAW \
      menuselect.makeopts; \
    make -j"$(nproc)"; \
    make DESTDIR=/out install; \
    make DESTDIR=/out samples; \
    mkdir -p /out/opt/asterisk; \
    mv /out/etc/asterisk /out/opt/asterisk/samples

FROM debian:${DEBIAN_VERSION}

LABEL org.opencontainers.image.title="pterodactyl-asterisk" \
      org.opencontainers.image.description="Asterisk 22 (PJSIP) for Pterodactyl" \
      org.opencontainers.image.licenses="GPL-2.0-only"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini iproute2 openssl tzdata nodejs \
      libssl3 libxml2 libxslt1.1 libsqlite3-0 libuuid1 libedit2 libncurses6 \
      libcurl4 libsrtp2-1 zlib1g \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/ /
RUN ldconfig

RUN set -eux; \
    missing="$(ldd /usr/sbin/asterisk /usr/lib/asterisk/modules/*.so 2>&1 | grep 'not found' || true)"; \
    if [ -n "${missing}" ]; then echo "Не хватает библиотек:"; echo "${missing}"; exit 1; fi; \
    asterisk -V

RUN useradd -m -d /home/container -u 988 -s /bin/bash container

COPY entrypoint.sh /entrypoint.sh
COPY scripts/      /opt/asterisk/scripts/
COPY templates/    /opt/asterisk/templates/
COPY defaults/     /opt/asterisk/defaults/
RUN chmod +x /entrypoint.sh

ENV HOME=/home/container \
    USER=container \
    TZ=UTC

WORKDIR /home/container

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/bin/bash", "/entrypoint.sh"]
