#!/usr/bin/env bash

set -e

random_octet() {
	printf "%d\n" 0x$(openssl rand -hex 1)
}

# Generate the random IPv4 address
random_ip() {
	echo "$(random_octet).$(random_octet).$(random_octet).$(random_octet)"
}

random_port() {
	r=$(printf "%d\n" 0x$(openssl rand -hex 2))
	echo $(( r % 32768 + 32768 ))
}

random_id() {
	r=$(printf "%d\n" 0x$(openssl rand -hex 3))
	echo $r
}

# Generate the random IPv6 address
random_ipv6() {
	openssl rand -hex 16 | sed 's/../&:/g' | cut -d: -f1-16
}

lower() {
	tr '[:upper:]' '[:lower:]'
}

upper() {
	tr '[:lower:]' '[:upper:]'
}

random_sha256() {
	head -c 32 /dev/urandom | sha256sum |  sed 's/../&:/g' | cut -d: -f1-32 | upper
}

cat << EOF
IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application $(random_port) UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 $(random_ip)
a=candidate:$(random_id) 1 udp $(random_id) $(uuidgen | lower).local $(random_port) typ host generation 0 network-id 2 network-cost 50
a=candidate:$(random_id) 1 udp $(random_id) $(uuidgen | lower).local $(random_port) typ host generation 0 network-id 1 network-cost 50
a=candidate:$(random_id) 1 udp $(random_id) $(random_ip) $(random_port) typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 50
a=candidate:$(random_id) 1 udp $(random_id) $(random_ipv6) $(random_port) typ srflx raddr :: rport 0 generation 0 network-id 2 network-cost 50
a=candidate:$(random_id) 1 tcp $(random_id) $(uuidgen | lower).local 9 typ host tcptype active generation 0 network-id 1 network-cost 50
a=candidate:$(random_id) 1 tcp $(random_id) $(uuidgen | lower).local 9 typ host tcptype active generation 0 network-id 2 network-cost 50
a=ice-ufrag:QstP
a=ice-pwd:$(head -c 12 /dev/urandom | base64)
a=ice-options:trickle
a=fingerprint:sha-256 $(random_sha256)
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
EOF
