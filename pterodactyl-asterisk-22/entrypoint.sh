#!/bin/bash
cd /home/container || exit 1

export TZ="${TZ:-UTC}"
export INTERNAL_IP
INTERNAL_IP="$(ip route get 1 2>/dev/null | awk '{print $(NF-2);exit}')"

echo "[entrypoint] Подготовка конфигурации Asterisk..."
if ! node /opt/asterisk/scripts/render-config.js; then
    echo "[entrypoint] Не удалось подготовить конфигурацию, запуск отменён." >&2
    exit 1
fi

rm -f /home/container/run/asterisk.pid /home/container/run/asterisk.ctl

STARTUP="${STARTUP:-asterisk -c -C /home/container/etc/asterisk/asterisk.conf}"

PARSED=$(echo "${STARTUP}" | sed -e 's/{{/${/g' -e 's/}}/}/g' | eval echo "$(cat -)")

echo ":/home/container$ ${PARSED}"
# shellcheck disable=SC2086
exec env ${PARSED}
