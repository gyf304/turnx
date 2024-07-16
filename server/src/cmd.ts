#!/usr/bin/env node

import { binpath } from "./index.js";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const path = binpath();

const p = spawn(path, args, {
	stdio: "inherit",
});

process.on("exit", () => p.kill());

p.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
	} else {
		process.exit(code);
	}
});
