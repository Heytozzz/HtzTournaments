// HtzTournaments — reads a Twitch channel's chat (anonymous, read only) like HtzRoulette does:
// Twitch's IRC protocol straight over a WebSocket, no server and no login needed.
'use strict';

const Twitch = (() => {
  let ws = null;
  let channel = '';
  let onMessage = () => {};
  let onStatus = () => {};
  let wanted = false; // keep reconnecting while the user wants to be connected
  let retry = null;

  function unescapeTag(v) {
    if (!v) return v;
    return v.replace(/\\(.)/g, (m, ch) => ({ s: ' ', ':': ';', r: '\r', n: '\n' }[ch] ?? ch));
  }
  function parseLine(line) {
    let rest = line;
    const tags = {};
    if (rest.startsWith('@')) {
      const i = rest.indexOf(' ');
      rest.slice(1, i).split(';').forEach((pair) => {
        const eq = pair.indexOf('=');
        tags[eq === -1 ? pair : pair.slice(0, eq)] = eq === -1 ? '' : unescapeTag(pair.slice(eq + 1));
      });
      rest = rest.slice(i + 1);
    }
    let prefix = '';
    if (rest.startsWith(':')) {
      const i = rest.indexOf(' ');
      prefix = rest.slice(1, i);
      rest = rest.slice(i + 1);
    }
    const ti = rest.indexOf(' :');
    const head = ti === -1 ? rest : rest.slice(0, ti);
    const message = ti === -1 ? '' : rest.slice(ti + 2);
    const [command] = head.trim().split(' ');
    return { tags, prefix, command, message };
  }

  function open() {
    clearTimeout(retry);
    const sock = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    ws = sock;
    onStatus('connecting', channel);
    sock.onopen = () => {
      sock.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      sock.send('PASS SCHMOOPIIE');
      sock.send(`NICK justinfan${Math.floor(10000 + Math.random() * 90000)}`);
      sock.send(`JOIN #${channel}`);
    };
    sock.onmessage = (ev) => {
      ev.data.split('\r\n').filter(Boolean).forEach((line) => {
        if (line.startsWith('PING')) { sock.send('PONG :tmi.twitch.tv'); return; }
        const p = parseLine(line);
        if (p.command === 'JOIN' || p.command === 'ROOMSTATE') onStatus('connected', channel);
        else if (p.command === 'NOTICE' && /improperly|failed|banned|suspended/i.test(p.message)) onStatus('error', p.message);
        else if (p.command === 'PRIVMSG') {
          // Twitch adds an invisible character to repeated messages
          const text = p.message.replace(/[\u{E0000}-\u{E007F}​-‍﻿]/gu, '').trim();
          const login = p.prefix.split('!')[0].toLowerCase();
          if (text && login) onMessage({ login, displayName: p.tags['display-name'] || login, text });
        }
      });
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (wanted) { onStatus('connecting', channel); retry = setTimeout(open, 3000); } else onStatus('off');
    };
    sock.onerror = () => { /* onclose follows and retries */ };
  }

  function connect(ch) {
    channel = String(ch || '').trim().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').split(/[/?]/)[0].toLowerCase();
    if (!/^[a-z0-9_]{2,25}$/.test(channel)) { onStatus('error', 'Nombre de canal no válido'); return false; }
    disconnect(true);
    wanted = true;
    open();
    return true;
  }
  function disconnect(silent = false) {
    wanted = false;
    clearTimeout(retry);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* closed */ } }
    if (!silent) onStatus('off');
  }

  return {
    connect,
    disconnect,
    on(handlers) { onMessage = handlers.message || onMessage; onStatus = handlers.status || onStatus; },
    get channel() { return channel; },
  };
})();
