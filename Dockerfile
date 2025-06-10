FROM node:18

# Install QPDF and other tools
RUN echo 'deb http://deb.debian.org/debian bullseye-backports main' > /etc/apt/sources.list.d/backports.list && \
    apt-get update && \
    apt-get install -y -t bullseye-backports qpdf && \
    apt-get install -y \
    ghostscript \
    imagemagick \
    pdftk \
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
