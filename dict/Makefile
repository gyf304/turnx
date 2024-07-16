.PHONY: all clean

all: dict.bin

clean:
	rm -f dict.bin
	rm -rf src

src: list.txt
	./buildsrc.sh

dict.bin: src request.txt
	zstd --maxdict=8384 --train-cover=d=8,steps=300,split=60 --train -o dict.bin.tmp -r src
	cat request.txt >> dict.bin.tmp
	tail -c 8192 dict.bin.tmp > dict.bin
	rm dict.bin.tmp
