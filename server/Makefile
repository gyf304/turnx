.PHONY: all clean

all: dist/bin/server-linux-amd64 dist/bin/server-linux-arm64 dist/bin/server-darwin-amd64 dist/bin/server-darwin-arm64 dist/bin/server-windows-amd64.exe dist/bin/server-windows-arm64.exe

clean:
	rm -rf dist/bin

dist/bin/server-linux-amd64: go/*
	mkdir -p dist/bin
	cd go && GOOS=linux GOARCH=amd64 go build -o ../dist/bin/server-linux-amd64

dist/bin/server-linux-arm64: go/*
	mkdir -p dist/bin
	cd go && GOOS=linux GOARCH=arm64 go build -o ../dist/bin/server-linux-arm64

dist/bin/server-darwin-amd64: go/*
	mkdir -p dist/bin
	cd go && GOOS=darwin GOARCH=amd64 go build -o ../dist/bin/server-darwin-amd64

dist/bin/server-darwin-arm64: go/*
	mkdir -p dist/bin
	cd go && GOOS=darwin GOARCH=arm64 go build -o ../dist/bin/server-darwin-arm64

dist/bin/server-windows-amd64.exe: go/*
	mkdir -p dist/bin
	cd go && GOOS=windows GOARCH=amd64 go build -o ../dist/bin/server-windows-amd64.exe

dist/bin/server-windows-arm64.exe: go/*
	mkdir -p dist/bin
	cd go && GOOS=windows GOARCH=arm64 go build -o ../dist/bin/server-windows-arm64.exe
