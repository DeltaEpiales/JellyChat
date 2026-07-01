const { exec } = require('child_process');

let peerCache = {};
let selfName = 'Local Machine';
let selfDnsName = '';

function updateTailscaleStatus() {
  const tailscaleCmd = '"C:\\Program Files\\Tailscale\\tailscale.exe" status --json';
  exec(tailscaleCmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing tailscale status:`, error);
      return;
    }
    
    try {
      const data = JSON.parse(stdout);
      const newCache = {};
      
      // Add self
      if (data.Self) {
        selfDnsName = data.Self.DNSName ? data.Self.DNSName.replace(/\.$/, '') : '';
        selfName = data.Self.DNSName ? data.Self.DNSName.split('.')[0] : data.Self.HostName;
        const selfOS = data.Self.OS || 'Unknown';
        if (data.Self.TailscaleIPs) {
          data.Self.TailscaleIPs.forEach(ip => {
            newCache[ip.toLowerCase()] = { name: selfName, os: selfOS };
          });
        }
      }
      
      // Add peers
      if (data.Peer) {
        for (const [key, peer] of Object.entries(data.Peer)) {
          if (peer.TailscaleIPs) {
            const peerName = peer.DNSName ? peer.DNSName.split('.')[0] : peer.HostName;
            const peerOS = peer.OS || 'Unknown';
            peer.TailscaleIPs.forEach(ip => {
              newCache[ip.toLowerCase()] = { name: peerName, os: peerOS };
            });
          }
        }
      }
      
      peerCache = newCache;
    } catch (parseError) {
      console.error(`Error parsing tailscale JSON: ${parseError.message}`);
    }
  });
}

// Initial update
updateTailscaleStatus();

// Update every 30 seconds
setInterval(updateTailscaleStatus, 30000);

function getDeviceNameByIp(ip) {
  if (!ip) return 'Unknown Device';
  
  let cleanIp = ip.replace(/^::ffff:/, '').toLowerCase();
  
  // Localhost resolution
  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
    return selfName;
  }
  
  return peerCache[cleanIp] ? peerCache[cleanIp].name : 'Unknown Device';
}

function getActivePeers() {
    const uniquePeers = {};
    for (const [ip, data] of Object.entries(peerCache)) {
        if (!uniquePeers[data.name]) {
            uniquePeers[data.name] = { name: data.name, os: data.os, ip };
        }
    }
    return Object.values(uniquePeers);
}

function getSelfIps() {
    const ips = [];
    for (const [ip, data] of Object.entries(peerCache)) {
        if (data.name === selfName) {
            ips.push(ip);
        }
    }
    return ips;
}

function getSelfDnsName() {
    return selfDnsName;
}

module.exports = {
  getDeviceNameByIp,
  getActivePeers,
  getSelfIps,
  getSelfDnsName
};
