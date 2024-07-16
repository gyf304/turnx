import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const files: Record<string, Record<string, string>> = {
	"darwin": {
		"x64": "server-darwin-amd64",
		"arm64": "server-darwin-arm64"
	},
	"linux": {
		"x64": "server-linux-amd64",
		"arm64": "server-linux-arm64"
	},
	"win32": {
		"x64": "server-windows-amd64.exe",
		"arm64": "server-windows-arm64.exe"
	}
};

function dirname(): string {
	return __dirname;
}

export function binpath(): string {
	const platform = process.platform;
	const arch = process.arch;

	const file = files[platform]?.[arch];
	if (file === undefined) {
		throw new Error(`No suitable file found for platform ${platform} and architecture ${arch}`);
	}

	// find the file
	// @ts-ignore: TS1343 for import.meta.url
	const dir = dirname();
	const filePaths = [
		path.join(dir, "bin", file),
		path.join(dir, "../bin", file),
		path.join(dir, "../dist/bin", file),
		path.join(dir, "../../bin", file),
		path.join(dir, "../../dist/bin", file),
	];
	const filePath = filePaths.find((filePath) => fs.existsSync(filePath));
	if (filePath === undefined) {
		throw new Error(`File not found: ${filePaths.join(", ")}`);
	}
	return filePath;
}

export async function start(target: string, port?: number): Promise<ChildProcess & { port: number }> {
	const filePath = binpath();
	const args = ["-target", target];
	if (port !== undefined) {
		args.push("-port", port.toString());
	}
	const p = spawn(filePath, args);
	// wait for the first line of output
	const firstLine = await new Promise<string>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const stdoutHandler = (chunk: Buffer) => {
			stdout += chunk;
			const lines = stdout.split("\n");
			if (lines.length > 0) {
				resolve(lines[0]);
			}
			p.stdout!.off("data", stdoutHandler);
			p.stderr!.off("data", stderrHandler);
		};
		const stderrHandler = (chunk: Buffer) => {
			stderr += chunk;
		};
		p.stdout!.on("data", stdoutHandler);
		p.stderr!.on("data", stderrHandler);
		p.on("error", () => reject(new Error(stderr)));
		p.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(stderr));
			}
		});
	});
	if (!firstLine.startsWith("Listening on ")) {
		p.kill();
		throw new Error(`Failed to start server`);
	}
	const listenPort = parseInt(firstLine.split(" ", 10)[2]);
	process.on("exit", () => p.kill());
	return Object.assign(p, { port: listenPort });
}
