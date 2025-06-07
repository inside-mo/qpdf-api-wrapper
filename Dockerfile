FROM node:18

# Install required tools
RUN apt-get update && \
    apt-get install -y qpdf ghostscript imagemagick && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# ImageMagick security policy might prevent PDF operations, fix it
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml

WORKDIR /app
RUN mkdir -p /app/uploads && chmod 777 /app/uploads
COPY . .
RUN npm install
EXPOSE 1999
CMD ["npm", "start"]
