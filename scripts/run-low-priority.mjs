import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { getNpmCommand, getNpmInvocation } from './npm-command.mjs';

const scriptName = process.argv[2];

if (!scriptName) {
	console.error('Usage: node scripts/run-low-priority.mjs <npm-script>');
	process.exit(1);
}

function commandExists(command) {
	const result = spawnSync(command, ['--version'], {
		stdio: 'ignore',
		windowsHide: true
	});
	return !result.error;
}

const npmCommand = getNpmCommand();
const canUseLinuxLowPriority = process.platform === 'linux'
	&& commandExists('nice')
	&& commandExists('ionice');

const invocation = canUseLinuxLowPriority
	? { command: 'nice', args: ['-n', '19', 'ionice', '-c3', npmCommand, 'run', scriptName] }
	: getNpmInvocation(['run', scriptName]);

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
