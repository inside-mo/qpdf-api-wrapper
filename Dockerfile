# Dockerfile
FROM node:18

# 1) Install build deps for QPDF
RUN apt-get update && apt-get install -y \
    build-essential cmake git pkg-config zlib1g-dev libjpeg-dev libpng-dev libxml2-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 2) Build QPDF v12.2.0 from source
RUN cd /tmp \
  && git clone --branch v12.2.0 https://github.com/qpdf/qpdf.git \
  && cd qpdf \
  && mkdir build && cd build \
  && cmake -DCMAKE_BUILD_TYPE=Release .. \
  && make -j"$(nproc)" \
  && make install \
  && ldconfig \
  && rm -rf /tmp/qpdf

# 3) Install other PDF tools
RUN apt-get update && apt-get install -y \
    ghostscript \
    imagemagick \
    pdftk \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# 4) App setup
WORKDIR /app
RUN mkdir -p uploads && chmod 777 uploads
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 1999
CMD ["npm", "start"]
