package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/pion/stun/v2"
)

type funcSetter func(m *stun.Message) error

func (f funcSetter) AddTo(m *stun.Message) error {
	return f(m)
}

var targetUrl *url.URL

const (
	password      = "turnrpc"
	software      = "webrtcsocket"
	realm         = "webrtcsocket.org"
	turnrpcPrefix = "turnrpc:"
)

func randHex(n int) string {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func genUnauthResponse(msg *stun.Message) *stun.Message {
	return stun.MustBuild(
		stun.NewTransactionIDSetter(msg.TransactionID),
		stun.NewType(msg.Type.Method, stun.ClassErrorResponse),
		stun.ErrorCodeAttribute{
			Code:   stun.CodeUnauthorized,
			Reason: []byte("Unauthorized"),
		},
		stun.NewNonce(randHex(24)),
		stun.Realm([]byte(realm)),
		stun.Software([]byte(software)),
	)
}

func checkAuth(msg *stun.Message) (username string, nonce []byte, err error) {
	requiredAttrs := []stun.AttrType{
		stun.AttrUsername,
		stun.AttrNonce,
		stun.AttrRealm,
		stun.AttrMessageIntegrity,
	}
	for _, attr := range requiredAttrs {
		if _, ok := msg.Attributes.Get(attr); !ok {
			return "", nil, errors.New("No authentication factor " + attr.String())
		}
	}
	usernameAttr, _ := msg.Attributes.Get(stun.AttrUsername)
	username = string(usernameAttr.Value)
	if !strings.HasPrefix(username, turnrpcPrefix) {
		return "", nil, errors.New("Invalid username")
	}
	nonceAttr, _ := msg.Attributes.Get(stun.AttrNonce)
	nonce = nonceAttr.Value
	err = msg.Check(
		stun.NewLongTermIntegrity(username, realm, password),
	)
	if err != nil {
		return "", nil, err
	}
	return username, nonce, nil
}

func handleRequest(conn *net.UDPConn, addr *net.UDPAddr, msg *stun.Message) {
	switch msg.Type.Class {
	case stun.ClassRequest:
		switch msg.Type.Method {
		case stun.MethodBinding:
			response := stun.MustBuild(
				stun.NewTransactionIDSetter(msg.TransactionID),
				stun.BindingSuccess,
				stun.XORMappedAddress{
					IP:   addr.IP,
					Port: addr.Port,
				},
			)
			conn.WriteToUDP(response.Raw, addr)
		case stun.MethodAllocate:
			username, _, err := checkAuth(msg)
			if err != nil {
				fmt.Println(err)
				conn.WriteToUDP(genUnauthResponse(msg).Raw, addr)
				return
			}
			req := username[len(turnrpcPrefix):]
			payload, err := turnpoke(req)
			if err != nil {
				fmt.Println(err)
				conn.WriteToUDP(genUnauthResponse(msg).Raw, addr)
				return
			}
			payload_len := len(payload)
			if len(payload) > 16 {
				payload = payload[:16]
				payload_len = 16
			} else if len(payload) < 16 {
				payload = append(payload, make([]byte, 16-len(payload))...)
			}
			ipBytes := append([]byte{0xfc}, payload[1:]...)
			topByte := payload[0]
			port := 0xc000 | (payload_len << 8) | int(topByte)
			response := stun.MustBuild(
				stun.NewTransactionIDSetter(msg.TransactionID),
				stun.NewType(stun.MethodAllocate, stun.ClassSuccessResponse),
				funcSetter(func(m *stun.Message) error {
					tmp := stun.XORMappedAddress{
						IP:   ipBytes,
						Port: port,
					}
					return tmp.AddToAs(m, stun.AttrXORRelayedAddress)
				}),
				stun.RawAttribute{
					Type:  stun.AttrLifetime,
					Value: []byte{0xef, 0xff, 0xff, 0xff},
				},
				stun.XORMappedAddress{
					IP:   addr.IP,
					Port: addr.Port,
				},
				stun.Realm([]byte(realm)),
				stun.Software([]byte(software)),
				stun.NewLongTermIntegrity(username, realm, password),
			)
			conn.WriteToUDP(response.Raw, addr)
		case stun.MethodRefresh:
			username, _, err := checkAuth(msg)
			if err != nil {
				conn.WriteToUDP(genUnauthResponse(msg).Raw, addr)
				return
			}
			lifetime, ok := msg.Attributes.Get(stun.AttrLifetime)
			isDealloc := true
			if ok {
				for _, v := range lifetime.Value {
					if v != 0 {
						isDealloc = false
						break
					}
				}
			} else {
				isDealloc = false
			}
			if isDealloc {
				response := stun.MustBuild(
					stun.NewTransactionIDSetter(msg.TransactionID),
					stun.NewType(stun.MethodRefresh, stun.ClassSuccessResponse),
					stun.RawAttribute{
						Type:  stun.AttrLifetime,
						Value: []byte{0x00, 0x00, 0x00, 0x00},
					},
					stun.NewLongTermIntegrity(username, realm, password),
				)
				conn.WriteToUDP(response.Raw, addr)
			} else {
				response := stun.MustBuild(
					stun.NewTransactionIDSetter(msg.TransactionID),
					stun.NewType(stun.MethodRefresh, stun.ClassErrorResponse),
					stun.ErrorCodeAttribute{
						Code:   stun.CodeInsufficientCapacity,
						Reason: []byte("Insufficient Capacity"),
					},
					stun.NewLongTermIntegrity(username, realm, password),
				)
				conn.WriteToUDP(response.Raw, addr)
			}
		}
	}
}

func main() {
	port := 0
	flag.IntVar(&port, "port", port, "port to listen on")
	target := ""
	flag.StringVar(&target, "target", "", "target to connect to, must be a HTTP(S) address")
	flag.Parse()

	u, err := url.Parse(target)
	if err != nil {
		panic(err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		panic("target must be a HTTP(S) address")
	}
	targetUrl = u

	conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: port})
	if err != nil {
		panic(err)
	}
	defer conn.Close()
	localAddr := conn.LocalAddr().(*net.UDPAddr)
	fmt.Println("Listening on", localAddr.Port)

	buf := make([]byte, 65536)
	for {
		n, addr, err := conn.ReadFromUDP(buf[:])
		if err != nil {
			panic(err)
		}
		msg := stun.Message{}
		err = stun.Decode(buf[:n], &msg)
		if err != nil {
			continue
		}

		handleRequest(conn, addr, &msg)
	}
}
