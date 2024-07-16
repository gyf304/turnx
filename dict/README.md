Content in this directory is used to generate the `dict.bin` file, which is
a dictionary for the ZLIB compression shared by the server and client.

Note that we use zstd to generate the dictionary, however, the content
of the dictionary can be used with any other compression algorithm.

The dataset is mostly HTTP responses and SDP messages.
A short HTTP request is also appended to the dictionary to optimize HTTP requests.
