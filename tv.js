// Opens a URL in the LG webOS TV's browser over the TV's local control API (SSAP).
// Usage: node tv.js [url]
// The first run shows a pairing prompt on the TV; accept it with the remote.
const fs = require('fs');
const path = require('path');
const os = require('os');

const TV_IP = process.env.TV_IP || '192.168.188.34';
const KEY_FILE = path.join(__dirname, '.tv-key.json');

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.')) return a.address;
    }
  }
  return 'localhost';
}

const url = process.argv[2] || `http://${lanAddress()}:8080/index.html`;
const savedKey = fs.existsSync(KEY_FILE) ? JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))['client-key'] : undefined;

// Newer webOS firmware only accepts the secure socket on 3001, which uses a
// self-signed certificate. This script talks to nothing but the TV, so skipping
// certificate verification here is acceptable.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const TV_URL = `wss://${TV_IP}:3001`;

const ws = new WebSocket(TV_URL);
const fail = (msg) => { console.error(msg); process.exit(1); };
const timer = setTimeout(() => fail('Timed out waiting for the TV (is it on, and did you accept the prompt?)'), 60000);

ws.onerror = (e) => fail(`Could not connect to ${TV_URL}: ${e.message || e.error || ''}`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'register',
    id: 'register_0',
    payload: {
      pairingType: 'PROMPT',
      'client-key': savedKey,
      manifest: {
        manifestVersion: 1,
        appVersion: '1.0',
        permissions: ['LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CONTROL_AUDIO', 'CONTROL_POWER', 'READ_INSTALLED_APPS'],
      },
    },
  }));
  if (!savedKey) console.log('Look at the TV and accept the connection request with the remote…');
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'error') fail(`TV error: ${msg.error}`);

  if (msg.id === 'register_0' && msg.type === 'registered') {
    fs.writeFileSync(KEY_FILE, JSON.stringify({ 'client-key': msg.payload['client-key'] }));
    ws.send(JSON.stringify({ type: 'request', id: 'open_1', uri: 'ssap://system.launcher/open', payload: { target: url } }));
  }

  if (msg.id === 'open_1') {
    clearTimeout(timer);
    console.log(msg.payload && msg.payload.returnValue ? `Opened ${url} on the TV` : `TV replied: ${JSON.stringify(msg.payload)}`);
    ws.close();
  }
};
