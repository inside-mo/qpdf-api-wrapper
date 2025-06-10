# Dockerfile
FROM node:18

# 1) Install build tools & dependencies for QPDF
RUN apt-get update && apt-get install -y \
    build-essential cmake git pkg-config zlib1g-dev libjpeg-dev libpng-dev libxml2-dev ca-certificates \
  && mkdir -p /build

# 2) Clone & build QPDF 13.0.0 from source
RUN cd /build \
  && git clone --branch release-qpdf-13.0.0 https://github.com/qpdf/qpdf.git \
  && mkdir -p qpdf/build && cd qpdf/build \
  && cmake -DCMAKE_BUILD_TYPE=Release -DENABLE_DOCS=OFF .. \
  && make -j"$(nproc)" && make install \
  && ldconfig \
  && rm -rf /build

# 3) Install your other PDF tools
RUN apt-get update && apt-get install -y \
    ghostscript imagemagick pdftk \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# 4) App setup
WORKDIR /app
RUN mkdir -p uploads && chmod 777 uploads
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 1999
CMD ["npm", "start"]
