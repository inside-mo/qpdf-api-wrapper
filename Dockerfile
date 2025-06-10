FROM node:18

# Install QPDF from source with latest version
RUN apt-get update && \
    apt-get install -y wget build-essential cmake zlib1g-dev libjpeg-dev curl jq && \
    LATEST_VERSION=$(curl -s https://api.github.com/repos/qpdf/qpdf/releases/latest | jq -r .tag_name | sed 's/v//') && \
    wget https://github.com/qpdf/qpdf/releases/download/v${LATEST_VERSION}/qpdf-${LATEST_VERSION}.tar.gz && \
    tar xvf qpdf-${LATEST_VERSION}.tar.gz && \
    cd qpdf-${LATEST_VERSION} && \
    cmake . && \
    make && \
    make install && \
    cd .. && \
    rm -rf qpdf-${LATEST_VERSION}* 

# Install other required tools
RUN apt-get install -y \
    ghostscript \
    imagemagick \
    pdftk \
    && apt-get remove -y wget build-essential curl jq \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Configure ImageMagick policy to allow PDF operations
RUN if [ -f /etc/ImageMagick-6/policy.xml ]; then \
    sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml; \
    else \
    echo '<policymap><policy domain="coder" rights="read|write" pattern="PDF" /></policymap>' > /etc/ImageMagick-6/policy.xml; \
    fi

# Set the ImageMagick resource limits
RUN if [ -f /etc/ImageMagick-6/policy.xml ]; then \
    sed -i 's/<policy domain="resource" name="memory" value=".*"/<policy domain="resource" name="memory" value="2GiB"/' /etc/ImageMagick-6/policy.xml; \
    sed -i 's/<policy domain="resource" name="map" value=".*"/<policy domain="resource" name="map" value="4GiB"/' /etc/ImageMagick-6/policy.xml; \
    sed -i 's/<policy domain="resource" name="area" value=".*"/<policy domain="resource" name="area" value="1GiB"/' /etc/ImageMagick-6/policy.xml; \
    sed -i 's/<policy domain="resource" name="disk" value=".*"/<policy domain="resource" name="disk" value="8GiB"/' /etc/ImageMagick-6/policy.xml; \
    fi

WORKDIR /app
RUN mkdir -p /app/uploads && chmod 777 /app/uploads
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 1999
CMD ["npm", "start"]
