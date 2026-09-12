// Server keeper script - starts Next.js and keeps process alive
const { spawn } = require('child_process');
const http = require('http');

// Start Next.js
const next = spawn('node', [
  'node_modules/next/dist/bin/next', 
  'dev', 
  '-p', '3000'
], {
  cwd: '/home/z/my-project',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
});

next.stdout.on('data', (data) => {
  process.stdout.write(data);
});

next.stderr.on('data', (data) => {
  process.stderr.write(data);
});

next.on('exit', (code) => {
  console.log('Next.js exited with code:', code);
  process.exit(code || 1);
});

// Health check server on port 3001
const healthServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
});
healthServer.listen(3001, () => {
  console.log('Health check server on port 3001');
});

// Keep alive
setInterval(() => {
  http.get('http://127.0.0.1:3000/', (res) => {
    // Server is alive
  }).on('error', () => {
    // Server might be compiling, that's ok
  });
}, 30000);

console.log('Server keeper started, PID:', process.pid);
