import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['scripts/icon-worker.cjs'], { stdio: 'inherit', windowsHide: true, env });
child.on('exit', code => { process.exitCode = code || 0; });
