#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const INIT = argv.includes('--init');
const rootIdx = argv.indexOf('--root');

const RUNTIME_ROOT = '/home/container';
const ROOT = path.resolve(rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : RUNTIME_ROOT);

const TEMPLATES = process.env.ASTERISK_TEMPLATES_DIR || '/opt/asterisk/templates';
const DEFAULTS = process.env.ASTERISK_DEFAULTS_DIR || '/opt/asterisk/defaults';
const SAMPLES = process.env.ASTERISK_SAMPLES_DIR || '/opt/asterisk/samples';

const SKIP_SAMPLES = new Set([
  'users.conf', 'extensions.ael', 'extensions.lua', 'dundi.conf', 'asterisk.conf',
]);

const env = process.env;
const log = (m) => console.log(`[asterisk-egg] ${m}`);
const warn = (m) => console.warn(`[asterisk-egg] ВНИМАНИЕ: ${m}`);

const toInt = (v, def, min, max) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
};

const toBool = (v, def) => {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
};

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const CIDR = new RegExp(`^${OCTET}(\\.${OCTET}){3}(/(3[0-2]|[12]?\\d))?$`);
const HOST_PORT = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

function isPrivateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function writeFile(file, content, mode = 0o640) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, file);
}

function renderTemplate(name, vars) {
  const tpl = fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Шаблон ${name}: неизвестный плейсхолдер {{${key}}}`);
    return vars[key];
  });
}

function buildSettings() {
  const s = {};

  s.sipPort = toInt(env.SERVER_PORT, 5060, 1, 65535);
  s.tlsPort = toInt(env.SIP_TLS_PORT, 0, 0, 65535);
  if (s.tlsPort && s.tlsPort === s.sipPort) {
    warn('SIP_TLS_PORT совпадает с SERVER_PORT — TLS отключён.');
    s.tlsPort = 0;
  }

  s.rtpStart = toInt(env.RTP_START, 10000, 1024, 65534);
  s.rtpEnd = toInt(env.RTP_END, 10049, 1024, 65535);
  if (s.rtpStart % 2 !== 0) {
    s.rtpStart += 1;
    warn(`RTP_START должен быть чётным, использую ${s.rtpStart}.`);
  }
  if (s.rtpEnd <= s.rtpStart + 1) {
    const fixed = Math.min(s.rtpStart + 49, 65535);
    warn(`Диапазон RTP некорректен (${s.rtpStart}-${s.rtpEnd}), использую ${s.rtpStart}-${fixed}.`);
    s.rtpEnd = fixed;
  } else if (s.rtpEnd < s.rtpStart + 9) {
    warn(`Диапазон RTP очень мал (${s.rtpEnd - s.rtpStart + 1} портов): ` +
      `одновременных потоков будет не больше ${Math.floor((s.rtpEnd - s.rtpStart + 1) / 2)}.`);
  }
  if (s.sipPort >= s.rtpStart && s.sipPort <= s.rtpEnd) {
    warn(`SIP-порт ${s.sipPort} попадает в диапазон RTP ${s.rtpStart}-${s.rtpEnd}.`);
  }

  let ext = String(env.EXTERNAL_IP || '').trim();
  if (ext && !IPV4.test(ext)) {
    warn(`EXTERNAL_IP="${ext}" — не IPv4-адрес, игнорирую.`);
    ext = '';
  }
  if (!ext) {
    const srv = String(env.SERVER_IP || '').trim();
    if (IPV4.test(srv) && !isPrivateV4(srv)) {
      ext = srv;
      log(`EXTERNAL_IP не задан, использую публичный SERVER_IP=${ext}.`);
    } else {
      warn('EXTERNAL_IP не задан, а SERVER_IP не публичный. Если сервер за NAT — ' +
        'задайте EXTERNAL_IP, иначе будет односторонняя слышимость.');
    }
  }
  s.externalIp = ext;

  const rawNets = env.LOCAL_NET === undefined
    ? '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8'
    : env.LOCAL_NET;
  s.localNets = String(rawNets).split(',').map((x) => x.trim()).filter(Boolean).filter((n) => {
    if (CIDR.test(n)) return true;
    warn(`LOCAL_NET: "${n}" — некорректная сеть, пропускаю.`);
    return false;
  });

  s.stun = String(env.STUN_SERVER || '').trim();
  if (s.stun && !HOST_PORT.test(s.stun)) {
    warn(`STUN_SERVER="${s.stun}" некорректен, игнорирую.`);
    s.stun = '';
  }
  s.ice = toBool(env.ICE_SUPPORT, false);

  s.verbose = toInt(env.ASTERISK_VERBOSE, 3, 0, 10);
  s.debug = toInt(env.ASTERISK_DEBUG, 0, 0, 10);

  s.manage = toBool(env.MANAGE_CONFIG, true);
  s.demoCount = toInt(env.DEMO_ENDPOINTS, 2, 0, 10);

  return s;
}

function genAsteriskConf(s) {
  return renderTemplate('asterisk.conf.tpl', {
    VERBOSE: String(s.verbose),
    DEBUG: String(s.debug),
  });
}

function genRtpConf(s) {
  const lines = [];
  if (s.ice || s.stun) {
    lines.push(`icesupport=${s.ice ? 'yes' : 'no'}`);
    if (s.stun) lines.push(`stunaddr=${s.stun}`);
    const internal = String(env.INTERNAL_IP || '').trim();
    if (s.ice && s.externalIp && IPV4.test(internal)) {
      lines.push(`ice_host_candidates=${internal} => ${s.externalIp}`);
    }
  }
  return renderTemplate('rtp.conf.tpl', {
    RTP_START: String(s.rtpStart),
    RTP_END: String(s.rtpEnd),
    RTP_STREAMS: String(Math.floor((s.rtpEnd - s.rtpStart + 1) / 2)),
    ICE_BLOCK: lines.join('\n'),
  });
}

function ensureCert(s) {
  const dir = path.join(ROOT, 'certs');
  const crt = path.join(dir, 'asterisk.crt');
  const key = path.join(dir, 'asterisk.key');
  if (fs.existsSync(crt) && fs.existsSync(key)) return true;

  const cn = s.externalIp || os.hostname() || 'asterisk';
  const san = IPV4.test(cn) ? `IP:${cn}` : `DNS:${cn}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', crt, '-days', '825',
      '-subj', `/CN=${cn}`, '-addext', `subjectAltName=${san}`,
    ], { stdio: 'ignore' });
    fs.chmodSync(key, 0o600);
    log(`Создан самоподписанный сертификат ${path.join(RUNTIME_ROOT, 'certs/asterisk.crt')} (CN=${cn}). ` +
      'Для продакшена замените его своим (certs/asterisk.crt + certs/asterisk.key).');
    return true;
  } catch (e) {
    warn(`Не удалось создать TLS-сертификат (${e.message}) — TLS отключён.`);
    return false;
  }
}

function genPjsipTransport(s) {
  const nat = [];
  if (s.externalIp) {
    nat.push(`external_media_address=${s.externalIp}`);
    nat.push(`external_signaling_address=${s.externalIp}`);
    for (const n of s.localNets) nat.push(`local_net=${n}`);
  }

  let tlsBlock = '';
  let tlsState = 'выключен (SIP_TLS_PORT=0)';
  if (s.tlsPort && ensureCert(s)) {
    tlsState = `включён, порт ${s.tlsPort}`;
    tlsBlock = [
      '',
      '[transport-tls]',
      'type=transport',
      'protocol=tls',
      `bind=0.0.0.0:${s.tlsPort}`,
      `cert_file=${RUNTIME_ROOT}/certs/asterisk.crt`,
      `priv_key_file=${RUNTIME_ROOT}/certs/asterisk.key`,
      'verify_client=no',
      'verify_server=no',
      ...nat,
    ].join('\n');
  }

  return renderTemplate('pjsip_transport.conf.tpl', {
    SIP_PORT: String(s.sipPort),
    TLS_STATE: tlsState,
    NAT_STATE: s.externalIp ? `внешний адрес ${s.externalIp}` : 'не настроен (EXTERNAL_IP пуст)',
    NAT_OPTS: nat.join('\n'),
    TLS_BLOCK: tlsBlock,
  });
}

function genEndpoints(s) {
  const blocks = [];
  const created = [];
  for (let i = 1; i <= s.demoCount; i++) {
    const ext = String(1000 + i);
    const pass = crypto.randomBytes(12).toString('hex');
    created.push({ ext, pass });
    blocks.push([
      `[${ext}](endpoint-defaults)`,
      `auth=auth${ext}`,
      `aors=${ext}`,
      `callerid="Demo ${ext}" <${ext}>`,
      '',
      `[auth${ext}](auth-defaults)`,
      `username=${ext}`,
      `password=${pass}`,
      '',
      `[${ext}](aor-defaults)`,
      '',
    ].join('\n'));
  }
  const content = renderTemplate('pjsip_endpoints.conf.tpl', {
    DEMO_ENDPOINTS: blocks.length ? blocks.join('\n') : '; (демо-абоненты отключены: DEMO_ENDPOINTS=0)',
  });
  return { content, created };
}

function main() {
  const s = buildSettings();
  const etc = path.join(ROOT, 'etc', 'asterisk');

  for (const d of [
    'etc/asterisk', 'data/keys', 'logs/cdr-csv', 'logs/cdr-custom', 'run', 'certs',
    'spool/tmp', 'spool/outgoing', 'spool/monitor', 'spool/voicemail', 'spool/recording',
  ]) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  }

  const managed = {
    'asterisk.conf': () => genAsteriskConf(s),
    'rtp.conf': () => genRtpConf(s),
    'pjsip_transport.conf': () => genPjsipTransport(s),
  };
  for (const [name, produce] of Object.entries(managed)) {
    const file = path.join(etc, name);
    if (s.manage || !fs.existsSync(file)) {
      writeFile(file, produce(), 0o644);
      log(`${s.manage ? 'Сгенерирован' : 'Создан (отсутствовал)'}: etc/asterisk/${name}`);
    } else {
      log(`Не трогаю (MANAGE_CONFIG=0): etc/asterisk/${name}`);
    }
  }

  if (fs.existsSync(DEFAULTS)) {
    for (const name of fs.readdirSync(DEFAULTS)) {
      const dst = path.join(etc, name);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(path.join(DEFAULTS, name), dst);
        log(`Создан: etc/asterisk/${name}`);
      }
    }
  } else {
    warn(`Каталог ${DEFAULTS} не найден.`);
  }

  const endpointsFile = path.join(etc, 'pjsip_endpoints.conf');
  if (!fs.existsSync(endpointsFile)) {
    const { content, created } = genEndpoints(s);
    writeFile(endpointsFile, content, 0o640);
    log('Создан: etc/asterisk/pjsip_endpoints.conf');
    for (const { ext, pass } of created) {
      log(`  демо-абонент ${ext}  пароль: ${pass}`);
    }
    if (created.length) {
      log('  (пароли также лежат в etc/asterisk/pjsip_endpoints.conf — смените их)');
    }
  }

  if (fs.existsSync(SAMPLES)) {
    let copied = 0;
    for (const name of fs.readdirSync(SAMPLES)) {
      const src = path.join(SAMPLES, name);
      const dst = path.join(etc, name);
      if (SKIP_SAMPLES.has(name)) continue;
      if (fs.statSync(src).isFile() && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
        copied += 1;
      }
    }
    if (copied) log(`Добавлено штатных конфигов по умолчанию: ${copied}`);
  }

  log(`SIP: UDP/TCP ${s.sipPort}` + (s.tlsPort ? `, TLS ${s.tlsPort}` : '') +
    ` | RTP: ${s.rtpStart}-${s.rtpEnd}/udp | внешний IP: ${s.externalIp || 'не задан'}`);
  if (INIT) log('Установка завершена.');
}

try {
  main();
} catch (e) {
  console.error(`[asterisk-egg] ОШИБКА: ${e.stack || e.message}`);
  process.exit(1);
}
