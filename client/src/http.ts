const forbiddenHeaders = new Set([
	"host",
	"content-length",
	"connection",
	"upgrade",
	"keep-alive",
]);

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function capHeader(s: string): string {
	return s.split("-").map(cap).join("-");
}

export async function serializeHTTP(r: Request | Response): Promise<ArrayBuffer> {
	const url = new URL(r.url);
	const firstLine = r instanceof Response ?
		`HTTP/1.1 ${r.status} ${r.statusText}\r\n` :
		`${r.method} ${r.url} HTTP/1.1\r\n`;
	const headers: string[] = [];
	const body = await r.arrayBuffer();
	headers.push(`Host: ${url.host}\r\n`);
	headers.push(`Content-Length: ${body.byteLength}\r\n`);
	r.headers.forEach((value, key) => {
		const k = key.toLowerCase();
		if (forbiddenHeaders.has(k)) {
			return;
		}
		headers.push(`${capHeader(key)}: ${value}\r\n`);
	});
	const parts = [
		firstLine,
		...headers,
		"\r\n",
		body,
	];
	const blob = new Blob(parts);
	return blob.arrayBuffer();
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function find(buf: Uint8Array, sep: string): number {
	const target = encoder.encode(sep);
	for (let i = 0; i < buf.byteLength - target.byteLength; i++) {
		for (let j = 0; j < target.byteLength; j++) {
			if (buf[i + j] !== target[j]) {
				break;
			}
			if (j === target.byteLength - 1) {
				return i;
			}
		}
	}
	return -1;
}

interface StatusLine {
	version: string;
	status: number;
	statusText: string;
}

function parseStatusLine(line: string): StatusLine {
	const parts = line.split(" ");
	if (parts.length !== 3) {
		throw new Error("Invalid status line");
	}
	return {
		version: parts[0],
		status: parseInt(parts[1]),
		statusText: parts[2],
	};
}

export async function parseHTTPResponse(buf: ArrayBuffer): Promise<Response> {
	const u8 = new Uint8Array(buf);
	let bodyStart = find(u8, "\r\n\r\n");
	if (bodyStart === -1) {
		bodyStart = u8.byteLength;
	}
	const header = decoder.decode(u8.subarray(0, bodyStart));
	const body = u8.subarray(bodyStart + 4);
	const headerLines = header.split("\r\n");
	const headers = new Headers();
	headerLines.slice(1).forEach((line) => {
		const idx = line.indexOf(": ");
		if (idx === -1) {
			return;
		}
		const key = line.slice(0, idx);
		const value = line.slice(idx + 2);
		headers.append(key, value);
	});
	return new Response(body, {
		...parseStatusLine(headerLines[0]),
		headers,
	});
}
