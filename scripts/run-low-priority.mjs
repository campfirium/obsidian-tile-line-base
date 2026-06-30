import { spawn } from 'node:child_process';
import process from 'node:process';

const scriptName = process.argv[2];

if (!scriptName) {
	console.error('Usage: node scripts/run-low-priority.mjs <npm-script>');
	process.exit(1);
}

const invocation = process.platform === 'linux'
	? { command: 'nice', args: ['-n', '19', 'ionice', '-c3', 'npm', 'run', scriptName] }
	: process.platform === 'win32'
		? { command: 'cmd.exe', args: ['/d', '/s', '/c', `npm run ${scriptName}`] }
		: { command: 'npm', args: ['run', scriptName] };

let child;
try {
	child = spawn(invocation.command, invocation.args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
		windowsHide: true
	});
} catch (error) {
	console.error(error);
	process.exit(1);
}

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('close', (code, signal) => {
	if (signal) {
		console.error(`Command terminated by signal ${signal}`);
		process.exit(1);
	}
	process.exit(code ?? 1);
});
