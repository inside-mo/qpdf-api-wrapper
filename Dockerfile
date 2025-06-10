# Stage 1: build QPDF from source
FROM debian:bookworm-slim AS qpdf-builder

RUN apt-get update && apt-get install -y \
    build-essential cmake git pkg-config \
    zlib1g-dev libjpeg-dev libpng-dev libxml2-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Clone and build v12.2.0
RUN git clone --depth 1 --branch v12.2.0 https://github.com/qpdf/qpdf.git /src/qpdf \
  && mkdir /src/qpdf/build \
  && cd /src/qpdf/build \
  && cmake -DCMAKE_BUILD_TYPE=Release .. \
  && make -j"$(nproc)" \
  && make install \
  && ldconfig \
  && rm -rf /src/qpdf

# Stage 2: final image
FROM node:18

# Copy the newly built QPDF (binary + libs)
COPY --from=qpdf-builder /usr/local/bin/qpdf /usr/local/bin/qpdf
COPY --from=qpdf-builder /usr/local/lib/libqpdf* /usr/local/lib/
RUN ldconfig

# Install other PDF tooling
RUN apt-get update && apt-get install -y \
    ghostscript imagemagick pdftk \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p uploads && chmod 777 uploads

# Your Node app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 1999
CMD ["npm", "start"]
