import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['scripts/check-gemini.cjs', ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: true });
child.on('exit', code => { process.exitCode = code || 0; });
