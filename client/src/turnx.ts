import { Unzlib, Zlib } from "fflate";
import { parseHTTPResponse, serializeHTTP } from "./http";

function parseIPv6(address: string) {
	const parts = address.split(":");
	let hextets = [];
	let skipIndex = -1;

	for (let i = 0; i < parts.length; i++) {
		if (parts[i] === "") {
			if (skipIndex === -1) {
				skipIndex = i;
			} else {
				// Handle special case where "::" appears at the end
				hextets.push(0);
			}
		} else {
			hextets.push(parseInt(parts[i], 16));
		}
	}

	if (skipIndex !== -1) {
		const missingZeros = 8 - hextets.length;
		hextets = [
			...hextets.slice(0, skipIndex),
			...Array(missingZeros).fill(0),
			...hextets.slice(skipIndex)
		];
	}

	if (hextets.length !== 8) {
		throw new Error("Invalid IPv6 address");
	}

	const bytes = new Uint8Array(16);
	for (let i = 0; i < hextets.length; i++) {
		bytes[i * 2] = (hextets[i] >> 8) & 0xff;
		bytes[i * 2 + 1] = hextets[i] & 0xff;
	}

	return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function turnpoke(server: string, req: string, timeout?: number): Promise<Uint8Array> {
	const pc = new RTCPeerConnection({
		iceServers: [{
			urls: "turn:" + server,
			username: `turnrpc:${req}`,
			credential: "turnrpc",
		}],
		iceTransportPolicy: "relay",
	});
	pc.createDataChannel("data");
	let data: Uint8Array | undefined;
	const icePromise = new Promise<void>((resolve) => {
		pc.onicegatheringstatechange = () => {
			if (pc.iceGatheringState === "complete") {
				resolve();
			}
		};
		pc.onicecandidate = (ev) => {
			if (ev.candidate) {
				const parts = ev.candidate.candidate.split(" ");
				const type = parts[7];
				if (type === "relay") {
					const ip = parts[4];
					const port = parseInt(parts[5], 10);
					const len = port >> 8 & 0x1f;
					const topByte = port & 0xff;
					if (len > 16) {
						return;
					}
					const parsedIP = parseIPv6(ip);
					parsedIP[0] = topByte;
					data = parsedIP.slice(0, len);
				}
			}
		};
	});
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	try {
		if (timeout !== undefined) {
			await Promise.race([
				icePromise,
				new Promise((_, reject) => setTimeout(
					() => reject(new Error("Timeout while waiting for STUN response")), timeout
				))
			]);
		} else {
			await icePromise;
		}
	} finally {
		pc.close();
	}
	if (data === undefined) {
		throw new Error("No data. Is the server reachable?");
	}
	return data.slice();
}

function b64(buf: Uint8Array): string {
	return btoa(String.fromCharCode(...buf));
}

const reqPartSize = 256;
const batchSize = 32;
const b64dict = `
bmN0aW9uIHIoKXt0cnl7dmFyIHQ9UDtyZXR1cm4gUD1udWxsLHQuYXBwbHkodGhpcyxhcmd1
bWVudHMpfWNhdGNoKGUpe3JldHVybiBULmU9ZSxUfX1mdW5jdGlvbiBpKHQpe3JldHVybiBQ
PXQscn1mdW5jdGlvbiBvKHQpe3JldHVybiBudWxsPT10fHx0PT09ITB8fHQ9PT0hMXx8InN0
cmluZyI9PXR5cGVvZiB0fHwibnVtYmVyIj09dHlwZW9mIHR9ZnVuY3Rpb24gcyh0KXtyZXR1
cm4iZnVuY3Rpb24iPT10eXBlb2YgdHx8Im9iamVjdCI9PXR5cGVvZiB0JiZudWxsIT09dH1m
dW5jdGlvbiBhKHQpe3JldHVybiBvKHQpP25ldyBFcnJvcih2KHQpKTp0fWZ1bmN0aW9uIGMo
dCxlKXt2YXIgbixyPXQubGVuZ3RoLGk9bmV3IEFycmF5KHIrMSk7Zm9yKG49MDtyPm47Kytu
KWlbbl09dFtuXTtyZXR1cm4gaVtuXT1lLGl9ZnVuY3Rpb24gdSh0LGUsbil7aWYoIUYuaXNF
UzUpcmV0dXJue30uaGFzT3duUHJvcGVydHkuY2FsbCh0LGUpP3RbZV06dm9pZCAwO3ZhciBy
PU9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodCxlKTtyZXR1cm4gbnVsbCE9cj9u
dWxsPT1yLmdldCYmbnVsbD09ci5zZXQ/ci52YWx1ZTpuOnZvaWQgMH1mdW5jdGlvbiBsKHQs
ZSxuKXtpZihvKHQpKWNzcyhlLCJkaXNwbGF5IiwhMSxyKSkmJmUuZ2V0Q2xpZW50UmVjdHMo
KS5sZW5ndGgmJihpPSJib3JkZXItYm94Ij09PWNlLmNzcyhlLCJib3hTaXppbmciLCExLHIp
LChvPXMgaW4gZSkmJihhPWVbc10pKSwoYT1wYXJzZUZsb2F0KGEpfHwwKStpdChlLHQsbnx8
KGk/ImJvcmRlciI6ImNvbnRlbnQiKSxvLHIsYSkrInB4In1mdW5jdGlvbiBhdChlLHQsbixy
LGkpe3JldHVybiBuZXcgYXQucHJvdG90eXBlLmluaXQoZSx0LG4scixpKX1jZS5leHRlbmQo
e2Nzc0hvb2tzOntvcGFjaXR5OntnZXQ6ZnVuY3Rpb24oZSx0KXtpZih0KXt2YXIgbj1HZShl
LCJvcGFjaXR5Iik7cmV0dXJuIiI9PT1uPyIxIjpufX19fSxjc3NOdW1iZXI6e2FuaW1hdGlv
bkl0ZXJhdGlvbkNvdW50OiEwLGFzcGVjdFJhdGlvOiEwLGJvcmRlckltYWdlU2xpY2U6ITAs
Y29sdW1uQ291bnQ6ITAsZmxleEdyb3c6ITAsZmxleFNocmluazohMCxmb250V2VpZ2h0OiEw
LGdyaWRBcmVhOiEwLGdyaWRDb2x1bW46ITAsZ3JpZENvbHVtbkVuZDohMCxncmlkQ29sdW1u
U3RhcnQ6ITAsZ3JpZFJvdzohMCxncmlkUm93RW5kOiEwLGdyaWRSb3dTdGFydDohMCxsaW5l
SGVpZ2h0OiEwLG9wYWNpdHk6ITAsb3JkZXI6ITAsb3JwaGFuczohMCxzY2FsZTohMCx3aWRv
d3M6ITAsekluZGV4OiEwLHpvb206ITAsZmlsbE9wYWNpdHk6ITAsZmxvb2RPcGFjaXR5OiEw
LHN0b3BPcGFjaXR5OiEwLHN0cm9rZU1pdGVybGltaXQ6ITAsc3Ryb2tlT3BhY2l0eTohMH0s
Y3NzUHJvcHM6e30sc3R5bGU6ZnVuY3Rpb24oZSx0LG4scil7aWYoZSYmMyE9PWUubm9kZVR5
cGUmJjghPT1lLm5vZGVUeXBlJiZlLnN0eWxlKXt2YXIgaSxvLGEscz1GKHQpLHU9emUudGVz
dCh0KSxsPWUuc3R5bGU7aWYodXx8KHQ9WmUocykpLGE9Y2UuY3NzSG9va3NbdF18fGNlLmNz
c0hvb2tzW3NdLHZvaWQgMD09PW4pcmV0dXJuIGEmJiJnZXQiaW4gYSYmdm9pZCAwIT09KGk9
YS5nZXQoZSwhMSxyKSk/aTpsW3RdOyJzdHJpbmciPT09KG89dHlwZW9mIG4pJiYoaT1ZLmV4
ZWMobikpJiZpWzFdJiYobj10ZShlLHQsaSksbz0ibnVtYmVyIiksbnVsbCE9biYmbj09biYm
KCJudW1iZXIiIT09b3x8dXx8KG4rPWkmJmlbM118fChjZS5jc3NOdW1iZXJbc10/IiI6InB4
IikpLGxlLmNsZWFyQ2xvbmVTdHlsZXx8IiIhPT1ufHwwIT09dC5pbmRleE9mKCJiYWNrZ3Jv
dW5kIil8fChsW3RdPSJpbmhlcml0IiksYSYmInNldCJpbiBhJiZ2b2lkIDA9PT0obj1hLnNl
dChlLG4scikpfHwodT9sLnNldFByb3BlcnR5KHQsbik6bFt0XT1uKSl9fSxjc3M6ZnVuYlth
XX0pfXZhciBQPS9cLysvZztmdW5jdGlvbiBRKGEsYil7cmV0dXJuIm9iamVjdCI9PT10eXBl
b2YgYSYmbnVsbCE9PWEmJm51bGwhPWEua2V5P2VzY2FwZSgiIithLmtleSk6Yi50b1N0cmlu
ZygzNil9CmZ1bmN0aW9uIFIoYSxiLGUsZCxjKXt2YXIgaz10eXBlb2YgYTtpZigidW5kZWZp
bmVkIj09PWt8fCJib29sZWFuIj09PWspYT1udWxsO3ZhciBoPSExO2lmKG51bGw9PT1hKWg9
ITA7ZWxzZSBzd2l0Y2goayl7Y2FzZSAic3RyaW5nIjpjYXNlICJudW1iZXIiOmg9ITA7YnJl
YWs7Y2FzZSAib2JqZWN0Ijpzd2l0Y2goYS4kJHR5cGVvZil7Y2FzZSBsOmNhc2UgbjpoPSEw
fX1pZihoKXJldHVybiBoPWEsYz1jKGgpLGE9IiI9PT1kPyIuIitRKGgsMCk6ZCxJKGMpPyhl
PSIiLG51bGwhPWEmJihlPWEucmVwbGFjZShQLCIkJi8iKSsiLyIpLFIoYyxiLGUsIiIsZnVu
Y3Rpb24oYSl7cmV0dXJuIGF9KSk6bnVsbCE9YyYmKE8oYykmJihjPU4oYyxlKyghYy5rZXl8
fGgmJmgua2V5PT09Yy5rZXk/IiI6KCIiK2Mua2V5KS5yZXBsYWNlKFAsIiQmLyIpKyIvIikr
YSkpLGIucHVzaChjKSksMTtoPTA7ZD0iIj09PWQ/Ii4iOmQrIjoiO2lmKEkoYSkpZm9yKHZh
ciBnPTA7ZzxhLmxlbmd0aDtnKyspe2s9CmFbZ107dmFyIGY9ZCtRKGssZyk7aCs9UihrLGIs
ZSxmLGMpfWVsc2UgaWYoZj1BKGEpLCJmdW5jdGlvbiI9PT10eXBlb2YgZilmb3IoYT1mLmNh
bGwoYSksZz0wOyEoaz1hLm5leHQoKSkuZG9uZTspaz1rLnZhbHVlLGY9ZCtRKGssZysrKSxo
Kz1SKGssYixlLGYsYyk7ZWxzZSBpZigib2JqZWN0Ij09PWspdGhyb3cgYj1TdHJpbmcoYSks
RXJyb3IoIk9iamVjdHMgYXJlIG5vdCB2YWxpZCBhcyBhIFJlYWN0IGNoaWxkIChmb3VuZDog
IisoIltvYmplY3QgT2JqZWN0XSI9PT1iPyJvYmplY3Qgd2l0aCBrZXlzIHsiK09iamVjdC5r
ZXlzKGEpLmpvaW4oIiwgIikrIn0iOmIpKyIpLiBJZiB5b3UgbWVhbnQgdG8gcmVuZGVyIGEg
Y29sbGVjdGlvbiBvZiBjaGlsZHJlbiwgdXNlIGFuIGFycmF5IGluc3RlYWQuIik7cmV0dXJu
IGh9CmZ1bmN0aW9uIFMoYSxiLGUpe2lmKG51bGw9PWEpcmV0dXJuIGE7dmFyIGQ9W10sYz0w
O1IoYSxkLCIiLCIiLGZ1bmN0aW9uKGEpe3JldHVybiBiLmNhbGwoZSxhLGMrKyl9KTtyZXR1
cm4gZH1mdW5jdGlvbiBUKGEpe2lmKC0xPT09YS5fc3RhdHVzKXt2YXIgYj1hLl9yZXN1bHQ7
Yj1iKCk7Yi50aGVuKGZ1bmN0aW9uKGIpe2lmKDA9PT1hLl9zdGF0dXN8fC0xPT09YS5fc3Rh
dHVzKWEuX3N0YXR1cz0xLGEuX3Jlc3VsdD1ifSxmdW5jdGlydHBtYXA6MTE1IHJ0eC85MDAw
MAphPWZtdHA6MTE1IGFwdD0xMTQKYT1ydHBtYXA6MTE2IHVscGZlYy85MDAwMAptPXZpZGVv
IDkgVURQL1RMUy9SVFAvU0FWUEYgOTYgOTcgOTggOTkgMTAwIDEwMSAxMjIgMTAyIDEyMSAx
MjcgMTIwIDEyNSAxMDcgMTA4IDEwOSAxMjQgMTE5IDEyMyAxMTggMTE0IDExNSAxMTYKYz1J
TiBJUDQgMC4wLjAuMAphPXJ0Y3A6OSBJTiBJUDQgMC4wLjAuMAphPWljZS11ZnJhZzpib2hQ
CmE9aWNlLXB3ZDoxbFBvZGdYbWdpWHo2elZNM1dvN2lYbnAKYT1pY2Utb3B0aW9uczp0cmlj
a2xlCmE9ZmluZ2VycHJpbnQ6c2hhLTI1NiA4MDoxRDpGNDo5Qzo2Qjo5ODpBNzo5NTpCRjpG
QToxRDpDRjo1NDoyOTowRDpENzozQjpEQTo3NToyNTo1MjozNzo1RjpCNzo1RDpGMDpFQzpD
MjpGNToxRjpGMDo0NAphPXNldHVwOmFjdHBhc3MKYT1taWQ6MjcKYT1leHRtYXA6MSB1cm46
aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0CmE9ZXh0bWFwOjIgaHR0cDovL3d3dy53
ZWJydGMub3JnL2V4cGVyaW1lbnRzL3J0cC1oZHJleHQvYWJzLXNlbmQtdGltZQphPWV4dG1h
cDozIHVybjozZ3BwOnZpZGVvLW9yaWVudGF0aW9uCmE9ZXh0bWFwOjQgaHR0cDovL3d3dy5p
ZXRmLm9yZy9pZC9kcmFmdC1ob2xtZXItcm1jYXQtdHJhbnNwb3J0LXdpZGUtY2MtZXh0ZW5z
aW9ucy0wMQphPWV4dG1hcDo1IGh0dHA6Ly93d3cud2VicnRjLm9yZy9leHBlcmltZW50cy9y
dHAtaGRyZXh0L3BsYXlvdXQtZGVsYXkKYT1leHRtYXA6NiBodHRwOi8vd3d3LndlYnJ0Yy5v
cmcvZXhwZXJpbWVudHMvcnRwLWhkcmV4dC92aWRlby1jb250ZW50LXR5cGUKYT1leHRtYXA6
NyBodHRwOi8vd3d3LndlYnJ0Yy5vcmcvZXhwZXJpbWVudHMvcnRwLWhkcmV4dC92aWRlby10
aW1pbmcKYT1leHRtYXA6OCBodHRwOi8vd3d3LndlYnJ0Yy5vcmcvZXhwZXJpbWVudHMvcnRw
LWhkcmV4dC9jb2xvci1zcGFjZQphPWV4dG1hcDo5IHVybjppZXRmOnBhcmFtczpydHAtaGRy
ZXh0OnNkZXM6bWlkCmE9ZXh0bWFwOjEwIHVybjppZXRmOnBhcmFtczpydHAtaGRyZXh0OnNk
ZXM6cnRwLXN0cmVhbS1pZAphPWV4dG1hcDoxMSB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4
dDpzZGVzOnJlcGFpcmVkLXJ0cC1zdHJlYW0taWQKYT1yZWN2b25seQphPXJ0Y3AtbXV4CmE9
cnRjcC1yc2l6ZQphPXJ0cG1hcDo5NiBWUDgvOTAwMDAKYT1ydGNwLWZiOjk2IGdvb2ctcmVt
YgphPXJ0Y3AtZmI6OTYgdHJhbnNwb3J0LWNjCmE9cnRjcC1mYjo5NiBjY20gZmlyCmE9cnRj
cC1mYjo5NiBuYWNrCmE9cnRjcDE1MzYwMDA7IGluY2x1ZGVTdWJEb21haW5zOyBwcmVsb2Fk
DQpDb250ZW50LVR5cGU6IGFwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRmLTgN
ClgtSlNELVZlcnNpb246IDE4LjMuMQ0KWC1KU0QtVmVyc2lvbi1UeXBlOiB2ZXJzaW9uDQpF
VGFnOiBXLyIyMDI2NS1aUndDL09HazB5Q1EwRS9tZTU2eUZQek1hSHMiDQpBY2NlcHQtUmFu
Z2VzOiBieXRlcw0KQWdlOiA4NjINCkRhdGU6IE1vbiwgMTUgSnVsIDIwMjQgMDQ6MTg6NTQg
R01UDQpYLVNlcnZlZC1CeTogY2FjaGUtZnJhLWV0b3U4MjIwMTU4LUZSQSwgY2FjaGUtbnlj
LWt0ZWIxODkwMDM5LU5ZQw0KWC1DYWNoZTogSElULCBISVQNClZhcnk6IEFjY2VwdC1FbmNv
ZGluZw0KYWx0LXN2YzogaDM9Ijo0NDMiO21hPTg2NDAwLGgzLTI5PSI6NDQzIjttYT04NjQw
MCxoMy0yNz0iOjQ0MyI7bWE9ODY0MDANCg0KLyoqCiAqIEBsaWNlbnNlIFJlYWN0CiAqIHJl
YWN0LWRvbS5wcm9kdWN0aW9uLm1pbi5qcwogKgogKiBDb3B5cmlnaHQgKGMpIEZhY2Vib29r
LCBJbmMuIGFuZCBpdHMgYWZmaWxpYXRlcy4KICoKICogVGhpcyBzb3VyY2UgY29kZSBpcyBs
aWNlbnNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UgZm91bmQgaW4gdGhlCiAqIExJQ0VOU0Ug
ZmlsZSBpbiB0aGUgcm9vdCBkaXJlY3Rvcnkgb2YgdGhpcyBzb3VyY2UgdHJlZS4KICovCi8q
CiBNb2Rlcm5penIgMy4wLjBwcmUgKEN1c3RvbSBCdWlsZCkgfCBNSVQKKi8KJ3VzZSBzdHJp
Y3QnO3ZhciBhYT1yZXF1aXJlKCJyZWFjdCIpLGNhPXJlcXVpcmUoInNjaGVkdWxlciIpO2Z1
bmN0aW9uIHAoYSl7Zm9yKHZhciBiPSJodHRwczovL3JlYWN0anMub3JnL2RvY3MvZXJyb3It
ZGVjb2Rlci5odG1sP2ludmFyaWFudD0iK2EsYz0xO2M8YXJndW1lbnRzLmxlbmd0aDtjKysp
Yis9IiZhcmdzW109IitlbmNvZGVVUklDb21wb25lbnQoYXJndW1lbnRzW2NdKTtyZXR1cm4i
TWluaWZpZWQgUmVhY3QgZXJyb3IgIyIrYSsiOyB2aXNpdCAiK2IrIiBmb3IgdGhlIGZ1bGwg
bWVzc2FnZSBvciB1c2UgdGhlIG5vbi1taW5pZmllZCBkZXYgZW52aXJvbm1lbnQgZm9yIGZ1
bGwgZXJyb3JzIGFuZCBhZGRpdGlvbmFsIGhlbHBmdWwgd2FybmluZ3MuIn12YXIgZGE9bmV3
IFNldCxlYT17fTtmdW5jdGlvbiBmYShhLGIpe2hhKGEsYik7aGEoYSsiQ2FwdHVyZSIsYil9
CmZ1bmN0aW9uIGhhKGEsYil7ZWFbYV09Yjtmb3IoYT0wO2E8Yi5sZW5ndGg7YSsrKWRhLmFk
ZChiW2FdKX0KdmFyIGlhPSEoInVuZGVmaW5lZCI9PT10eXBlb2Ygd2luZG93fHwidW5kZWZp
LjAuMC4xCnQ9MCAwCmE9dG9vbDpsaWJhdmZvcm1hdCA1OC4yOS4xMDAKbT12aWRlbyA1MDAx
IFJUUC9BVlAgOTYKYT1ydHBtYXA6OTYgSDI2NC85MDAwMAphPWZtdHA6OTYgbGV2ZWwtYXN5
bW1ldHJ5LWFsbG93ZWQ9MTtwYWNrZXRpemF0aW9uLW1vZGU9MTtwcm9maWxlLWxldmVsLWlk
PTQyMDAxZklOIElQNCAxMjcuMC4wLjEKcz0tCnQ9MCAwCmE9Z3JvdXA6QlVORExFIDAKYT1l
eHRtYXAtYWxsb3ctbWl4ZWQKYT1tc2lkLXNlbWFudGljOiBXTVMKbT1hcHBsaWNhdGlvbiA1
Mjc3NyBVRFAvRFRMUy9TQ1RQIHdlYnJ0Yy1kYXRhY2hhbm5lbApjPUlOIElQNCAxMDYuNDQu
MTAwLjUyCmE9Y2FuZGlkYXRlOjEzNTI5MDgxIDEgdWRwIDUyMzA3OSA3OTY1YjUyMC03NGU0
LTQ1Y2UtYmE4Yy0yOTk3ZDEyYWY2MzQubG9jYWwgNTk0NDMgdHlwIGhvc3QgZ2VuZXJhdGlv
biAwIG5ldHdvcmstaWQgMiBuZXR3b3JrLWNvc3QgNTAKYT1jYW5kaWRhdGU6MTY1NjcyMjYg
MSB1ZHAgODc0NjMwMCAyNDRjMWNiZC01OTk4LTQzMTQtYjEyMi1iZWE0MGIwYmFhZWYubG9j
YWwgNDI1NjQgdHlwIGhvc3QgZ2VuZXJhdGlvbiAwIG5ldHdvcmstaWQgMSBuZXR3b3JrLWNv
c3QgNTAKYT1jYW5kaWRhdGU6MjA2MzA0OCAxIHVkcCA5NDg1MTU5IDg0LjIxNy4yMjYuNjcg
NTIwODggdHlwIHNyZmx4IHJhZGRyIDAuMC4wLjAgcnBvcnQgMCBnZW5lcmF0aW9uIDAgbmV0
d29yay1pZCAxIG5ldHdvcmstY29zdCA1MAphPWNhbmRpZGF0ZTo1MjEyNjIxIDEgdWRwIDE2
NDMyOTM0IGMzOjY1OjRjOjMwOjc4OmY3OjJhOjJhOmMzOmEyOmZkOmQxOjFlOjlhOmNmOmU5
IDYyNDc2IHR5cCBzcmZseCByYWRkciA6OiBycG9ydCAwIGdlbmVyYXRpb24gMCBuZXR3b3Jr
LWlkIDIgbmV0d29yay1jb3N0IDUwCmE9Y2FuZGlkYXRlOjE1MTk3OTQ2IDEgdGNwIDExMzgx
NjY5IDlhMTMzZWNjLThlMmYtNDY0ZS1hNDMzLTBjNjc1MjJiMWM0ZC5sb2NhbCA5IHR5cCBo
b3N0IHRjcHR5cGUgYWN0aXZlIGdlbmVyYXRpb24gMCBuZXR3b3JrLWlkIDEgbmV0d29yay1j
b3N0IDUwCmE9Y2FuZGlkYXRlOjE0MjczMTY4IDEgdGNwIDY0OTgxNzIgMGRlYWFjN2QtODMy
NC00ZWJiLTk4NzMtYTc1MmYxN2NjNzM3LmxvY2FsIDkgdHlwIGhvc3QgdGNwdHlwZSBhY3Rp
dmUgZ2VuZXJhdGlvbiAwIG5ldHdvcmstaWQgMiBuZXR3b3JrLWNvc3QgNTAKYT1pY2UtdWZy
YWc6UXN0UAphPWljZS1wd2Q6dGIrSGRUUVRZWUZxZjl2QwphPWljZS1vcHRpb25zOnRyaWNr
bGUKYT1maW5nZXJwcmludDpzaGEtMjU2IEYzOjMwOjcwOkQzOjY9c2V0dXA6YWN0cGFzcwph
PW1pZDowCmE9c2N0cC1wb3J0OjUwMDAKYT1tYXgtbWVzc2FnZS1zaXplOjI2MjE0NApIVFRQ
LzEuMSAyMDAgT0sNCkNvbm5lY3Rpb246IGtlZXAtYWxpdmUNCkNvbnRlbnQtTGVuZ3RoOiAx
NzgNCkNhY2hlLUNvbnRyb2w6IG1heC1hZ2U9MzAwDQpDb250ZW50LVNlY3VyaXR5LVBvbGlj
eTogZGVmYXVsdC1zcmMgJ25vbmUnOyBzdHlsZS1zcmMgJ3Vuc2FmZS1pbmxpbmUnOyBzYW5k
Ym94DQpDb250ZW50LVR5cGU6IHRleHQvcGxhaW47IGNoYXJzZXQ9dXRmLTgNCkVUYWc6ICI3
ZTU3MDMxYmU0OTYyZjJkNDcxZjg4YTk0ODhkNjQ2NzFhYzFmOTJiOTBiNzAzMjM4NmMyMDY1
MDhkYTJlMzE5Ig0KU3RyaWN0LVRyYW5zcG9ydC1TZWN1cml0eTogbWF4LWFnZT0zMTUzNjAw
MA0KWC1Db250ZW50LVR5cGUtT3B0aW9uczogbm9zbmlmZg0KWC1GcmFtZS1PcHRpb25zOiBk
ZW55DQpYLVhTUy1Qcm90ZWN0aW9uOiAxOyBtb2RlPWJsb2NrDQpYLUdpdEh1Yi1SZXF1ZXN0
LUlkOiAzQ0YyOjE5QTZCNzoxMjkyM0U0OjE0OUU2RTc6NjY5NDkzNDINCkFjY2VwdC1SYW5n
ZXM6IGJ5dGVzDQpEYXRlOiBNb24sIDE1IEp1bCAyMDI0IDA0OjE4OjUwIEdNVA0KVmlhOiAx
LjEgdmFybmlzaA0KWC1TZXJ2ZWQtQnk6IGNhY2hlLWlhZC1raWFkNzAwMDEzMC1JQUQNClgt
Q2FjaGU6IEhJVA0KWC1DYWNoZS1IaXRzOiAwDQpYLVRpbWVyOiBTMTcyMTAxNzEzMC4wOTk0
NjQsVlMwLFZFMQ0KVmFyeTogQXV0aG9yaXphdGlvbixBY2NlcHQtRW5jb2RpbmcsT3JpZ2lu
DQpBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW46ICoNCkNyb3NzLU9yaWdpbi1SZXNvdXJj
ZS1Qb2xpY3k6IGNyb3NzLW9yaWdpbg0KWC1GYXN0bHktUmVxdWVzdC1JRDogNTVjZTA4ZTMz
ZGE0YzdhNTE5ZTcyMGQ3YWM1ZmU5NDM0ZTk0NGJmOA0KRXhwaXJlczogTW9uLCAxNSBKdWwg
MjAyNCAwNDoyMzo1MCBHTVQNClNvdXJjZS1BZ2U6IDIwNg0KDQp2PTAKbz1yb290IDI4OTA4
NDQ1MjYgMjg5MDg0MjgwNyBJTiBJUDQgCnM9REFTSAp0PTAgMzI1MTE5NzQ0MDAKYT1zb3Vy
Y2UtZmlsdGVyOiBpbmNsIElOIElQNCAqIAphPWZsdXRlLXRzaToxCmE9Zmx1dGUtY2g6MQpt
PWFwcGxpY2F0aW9uIDQwMDEgRkxVVEVDb250ZW50LVR5cGU6IGFwcGxpY2F0aW9uL3NkcA0K
R0VUIC8gSFRUUC8xLjENCkhvc3Q6IGxvY2FsaG9zdDo4MDAwDQo=
`.replaceAll("\n", "");
const dictStr = atob(b64dict);
const dict = new Uint8Array(dictStr.length);
for (let i = 0; i < dictStr.length; i += 1) {
	dict[i] = dictStr.charCodeAt(i);
}

export async function turnrpc(server: string, req: Uint8Array | ArrayBufferLike, timeout?: number): Promise<ArrayBuffer>;
export async function turnrpc(server: string, req: string, timeout?: number): Promise<string>;
export async function turnrpc(server: string, req: Uint8Array | ArrayBufferLike | string, timeout?: number): Promise<ArrayBuffer | string> {
	const buf = new Uint8Array(typeof req === "string" ? encoder.encode(req) : req);
	// compress the request using the preset dictionary
	const compedParts: Uint8Array[] = [];
	const zlib = new Zlib({
		level: 9,
		dictionary: dict,
	});
	zlib.ondata = (data) => {
		compedParts.push(data.slice());
	};
	zlib.push(buf);
	zlib.push(new Uint8Array(0), true);
	const comped = new Uint8Array(await (new Blob(compedParts)).arrayBuffer());

	// allocate a request id
	const id = await turnpoke(server, `s:${comped.byteLength}`, timeout);
	const b64id = b64(id);

	// send the request parts
	const reqParts = [];
	for (let i = 0; i < comped.byteLength; i += reqPartSize) {
		reqParts.push(comped.slice(i, i + reqPartSize));
	}
	while (reqParts.length > 0) {
		const batch = reqParts.splice(0, batchSize);
		const reqPartPromises: Promise<unknown>[] = [];
		for (let i = 0; i < batch.length; i++) {
			const part = batch[i];
			reqPartPromises.push(turnpoke(
				server,
				`c:${b64id}:${i * reqPartSize}:${b64(part)}`,
				timeout,
			));
		}
		await Promise.all(reqPartPromises);
	}

	// execute the request
	const respLenBuf = await turnpoke(server, `e:${b64id}`, timeout);
	if (respLenBuf.byteLength !== 4) {
		throw new Error("Invalid response length");
	}
	const respLenView = new DataView(respLenBuf.buffer);
	const respLen = respLenView.getUint32(0, false);

	// retrieve the response parts
	const respBuf = new Uint8Array(respLen);
	const retrieveJobs: (() => Promise<unknown>)[] = [];
	for (let i = 0; i < respLen; i += 16) {
		retrieveJobs.push(
			() => turnpoke(server, `r:${b64id}:${i}`, timeout).then((part) => {
				respBuf.set(part, i);
			})
		);
	}
	while (retrieveJobs.length > 0) {
		const batch = retrieveJobs.splice(0, batchSize);
		await Promise.all(batch.map((job) => job()));
	}
	let decompedParts: Uint8Array[] = [];
	const unzlib = new Unzlib({
		dictionary: dict,
	});
	unzlib.ondata = (data) => {
		decompedParts.push(data.slice());
	};
	unzlib.push(respBuf);
	const decomped = await (new Blob(decompedParts)).arrayBuffer();

	if (typeof req === "string") {
		return decoder.decode(decomped);
	}
	return decomped;
}

const localhosts = new Set(["localhost", "127.0.0.1", "::1"]);

export async function fetch(url: string | URL | Request, init?: FetchRequestInit): Promise<Response> {
	let req = new Request(url, init);
	let u = new URL(req.url);
	if (u.protocol !== "turnx:") {
		throw new Error("Invalid protocol, expected turnx:");
	}
	const httpUrl = req.url.replace(/^turnx:\/\//, "http://");
	req = new Request(httpUrl, req);
	u = new URL(req.url);
	if (localhosts.has(u.host)) {
		console.warn(
			`turnx fetch: using loopback address ${u.host}. ` +
			"This may not work on all platforms, try using a LAN address instead. " +
			"e.g. turnx://192.168.1.100:3478"
		);
	}
	const reqBuf = await serializeHTTP(req);
	const respBuf = await turnrpc(u.host, reqBuf);
	const resp = await parseHTTPResponse(respBuf);
	return resp;
}
