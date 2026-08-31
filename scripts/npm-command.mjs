export function getNpmCommand() {
	return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function getNpmInvocation(args) {
	if (process.platform === 'win32') {
		return {
			command: 'cmd.exe',
			args: ['/d', '/s', '/c', getNpmCommand(), ...args]
		};
	}

	return {
		command: getNpmCommand(),
		args
	};
}
